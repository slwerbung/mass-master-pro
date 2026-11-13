// Schreibende Aktionen der Projekte-Ansicht (Phase 2). Schattenmodus: solange app_config.projects_write_enabled
// nicht "true" ist, wird nichts nach HERO geschrieben (nur project_actions_log). HERO nur ueber _shared/email/hero.ts.
//
//   POST { action, heroId, ... }  ->  { ok: true, data } | { ok: false, error }
//   steps | set_step | complete | archive | logbook_note | create_events | bulk_archive (nur Admin)
//   Nachfassen: save_draft | send_followup | bulk_followup | set_autopilot | call_done
//   Arbeitsmodus (Phase 4): lock_for_hero (Karte 30 Min sperren, Vorher-Stand merken; optional `kind` und `threadId` aus einer Mail-Karte; die Rueckkehr macht hero-task-callback)
//   Mails sendet diese Function NIE selbst: send_followup/bulk_followup reichen die Sitzung des Benutzers an email-send weiter.

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireMailUser } from "../_shared/email/http.ts";
import { addLogbookEntry, heroGraphql, loadHeroKey, projectSteps, setStep } from "../_shared/email/hero.ts";
import { heroCreateAppointment } from "../_shared/booking/hero.ts";
import { canSee, isShadow } from "../_shared/projects/access.ts";
import { MAX_BULK, archiveAction, bulkArchiveAction, callDoneAction, completeAction, eventsAction, noteAction, saveDraftAction, setAutopilotAction, setStepAction, type ActionCtx, type HeroOps } from "../_shared/projects/actions.ts";
import { isMode } from "../_shared/projects/followup.ts";
import { assertThread } from "../_shared/email/access.ts";
import { lockForHero, parseChecklists, readProjectState } from "../_shared/projects/heroTask.ts";
import { stepKey } from "../_shared/projects/steps.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App.", { code: "unauthorized" });
  const body = await readJson(req);
  const action = String(body.action || "");
  if (!["steps", "set_step", "complete", "archive", "logbook_note", "create_events", "bulk_archive", "save_draft", "send_followup", "bulk_followup", "set_autopilot", "call_done", "lock_for_hero"].includes(action)) return fail("Unbekannte Aktion.");
  if (action === "bulk_archive" && user.role !== "admin") return fail("Nur für Admins.", { code: "forbidden" });

  try {
    const key = await loadHeroKey(sb);
    if (!key) return fail("HERO ist nicht aktiv (app_config hero_enabled / hero_api_key).");

    let stepCache: { id: number; name: string }[] | null = null;
    const ops: HeroOps = {
      listSteps: async () => (stepCache ??= await projectSteps(key, null)),
      setStep: (id, stepId) => setStep(key, id, stepId),
      addLogbook: (id, text) => addLogbookEntry(key, id, text),
      createEvent: (a) => heroCreateAppointment(key, { heroProjectId: a.heroId, title: a.title, startIso: a.startIso, endIso: a.endIso, categoryId: a.categoryId, partnerId: a.partnerId, description: a.description }),
    };
    const ctx: ActionCtx = { sb, ops, user: user.name || user.email || "Mitarbeiter", shadow: await isShadow(sb), canSee: (p) => canSee(user, p) };

    // Entwuerfe: Zugriff pruefen email-send bzw. saveDraftAction (Projekt des Entwurfs), hier keine heroId.
    if (action === "save_draft") return ok(await saveDraftAction(ctx, String(body.draftId || ""), { to: body.to, subject: body.subject, body: body.body }));
    if (action === "send_followup" || action === "bulk_followup") {
      const draftIds: string[] = action === "send_followup" ? [String(body.draftId || "")] : (Array.isArray(body.draftIds) ? body.draftIds.map(String) : []);
      if (!draftIds.length || draftIds.some((d) => !d)) return fail("Kein Entwurf angegeben.");
      if (draftIds.length > MAX_BULK) return fail(`Höchstens ${MAX_BULK} Mails je Aufruf.`);
      // Senden macht ausschliesslich email-send (Sitzung des Benutzers, eigene Postfaecher, Signatur, Thread, Logbuch).
      const sendOne = async (draftId: string) => {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/email-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: req.headers.get("authorization") || "" },
          body: JSON.stringify({ action: "send_followup", draftId }),
        });
        const j = await r.json().catch(() => null);
        if (!j?.ok) throw new Error(String(j?.error || `email-send HTTP ${r.status}`));
        return j.data as { shadow: boolean; message: string; warnings?: string[] };
      };
      if (action === "send_followup") return ok(await sendOne(draftIds[0]));
      const done: string[] = [];
      const failed: { draftId: string; error: string }[] = [];
      const warnings: string[] = [];
      let shadow = ctx.shadow;
      for (const draftId of draftIds) {
        try { const r = await sendOne(draftId); shadow = r.shadow; done.push(draftId); warnings.push(...(r.warnings ?? [])); }
        catch (e) { failed.push({ draftId, error: String((e as Error).message).slice(0, 200) }); }
      }
      return ok({ ok: true, shadow, done, failed, warnings, message: shadow ? `Schattenmodus: ${done.length} Mail(s) wären gesendet worden (nichts gesendet).` : `${done.length} gesendet${failed.length ? `, ${failed.length} fehlgeschlagen` : ""}.` });
    }

    // Zugriff: jedes betroffene Projekt muss fuer den Benutzer sichtbar sein.
    const ids: number[] = action === "bulk_archive" ? (Array.isArray(body.heroIds) ? body.heroIds.map(Number) : []) : [Number(body.heroId)];
    if (ids.length && ids.every((n) => Number.isFinite(n))) {
      const { data } = await sb.from("hero_projects").select("hero_id, assignee_emails, step_id").in("hero_id", ids);
      for (const id of ids) {
        const p = (data || []).find((r: any) => Number(r.hero_id) === id);
        if (action !== "bulk_archive" && !p) return fail("Projekt nicht gefunden (nicht mehr offen?).");
        if (p && !canSee(user, p)) return fail("Projekt nicht gefunden.");
      }
    } else if (action !== "steps") {
      return fail("Projekt fehlt.");
    }

    if (action === "steps") {
      const steps = await ops.listSteps();
      let current: number | null = null;
      if (Number.isFinite(Number(body.heroId))) {
        const { data } = await sb.from("hero_projects").select("step_id").eq("hero_id", Number(body.heroId)).maybeSingle();
        current = data?.step_id != null ? Number(data.step_id) : null;
      }
      return ok({ shadow: ctx.shadow, current, steps: steps.map((s) => ({ id: s.id, name: s.name, key: stepKey(s.name) })) });
    }

    const heroId = ids[0];
    switch (action) {
      case "set_step": return ok(await setStepAction(ctx, heroId, Number(body.stepId)));
      case "complete": return ok(await completeAction(ctx, heroId));
      case "archive": return ok(await archiveAction(ctx, heroId));
      case "logbook_note": return ok(await noteAction(ctx, heroId, String(body.text || "")));
      case "bulk_archive": return ok(await bulkArchiveAction(ctx, ids));
      case "call_done": return ok(await callDoneAction(ctx, heroId));
      case "lock_for_hero": {
        // Aus einer Mail-Karte: Thema muss zu den Postfaechern des Benutzers und zu diesem Projekt gehoeren.
        const threadId = body.threadId ? String(body.threadId) : null;
        if (threadId) {
          await assertThread(sb, user, threadId);
          const [th, ms] = await Promise.all([
            sb.from("email_threads").select("hero_project_match_id").eq("id", threadId).maybeSingle(),
            sb.from("email_messages").select("hero_project_match_id").eq("thread_id", threadId).not("hero_project_match_id", "is", null).limit(200),
          ]);
          const ids = new Set([th.data?.hero_project_match_id, ...(ms.data || []).map((m: any) => m.hero_project_match_id)].filter((x) => x != null).map(Number));
          if (!ids.has(heroId)) return fail("Dieses Thema gehört nicht zu diesem Projekt.");
        }
        const { data: cl } = await sb.from("app_config").select("value").eq("key", "projects_checklists").maybeSingle();
        return ok(await lockForHero(sb, { readState: (id) => readProjectState((k, q, v) => heroGraphql(k, q, v), key, id), checklists: parseChecklists(cl?.value) },
          { heroId, kind: body.kind ? String(body.kind) : null, threadId, actor: { id: user.id, name: ctx.user, isAdmin: user.role === "admin" } }));
      }
      case "set_autopilot": {
        const mode = body.mode === null ? null : body.mode;
        if (mode !== null && !isMode(mode)) return fail("Autopilot: off, suggest oder auto.");
        return ok(await setAutopilotAction(ctx, heroId, String(body.ruleKey || ""), mode));
      }
      case "create_events": {
        const { data } = await sb.from("app_config").select("key, value").in("key", ["projects_event_category_id", "booking_hero_category_id"]);
        const cfg = new Map((data || []).map((r: any) => [r.key, r.value]));
        const categoryId = Number(cfg.get("projects_event_category_id") || cfg.get("booking_hero_category_id")) || null;
        return ok(await eventsAction(ctx, heroId, body.events, categoryId));
      }
    }
    return fail("Unbekannte Aktion.");
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300));
  }
});
