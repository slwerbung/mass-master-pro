// Schreibende Aktionen der Projekte-Ansicht (Phase 2). Schattenmodus: solange app_config.projects_write_enabled
// nicht "true" ist, wird nichts nach HERO geschrieben (nur project_actions_log). HERO nur ueber _shared/email/hero.ts.
//
//   POST { action, heroId, ... }  ->  { ok: true, data } | { ok: false, error }
//   steps | set_step | complete | archive | logbook_note | create_events | bulk_archive (nur Admin)

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireMailUser } from "../_shared/email/http.ts";
import { addLogbookEntry, loadHeroKey, projectSteps, setStep } from "../_shared/email/hero.ts";
import { heroCreateAppointment } from "../_shared/booking/hero.ts";
import { canSee, isShadow } from "../_shared/projects/access.ts";
import { archiveAction, bulkArchiveAction, completeAction, eventsAction, noteAction, setStepAction, type ActionCtx, type HeroOps } from "../_shared/projects/actions.ts";
import { stepKey } from "../_shared/projects/steps.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App.", { code: "unauthorized" });
  const body = await readJson(req);
  const action = String(body.action || "");
  if (!["steps", "set_step", "complete", "archive", "logbook_note", "create_events", "bulk_archive"].includes(action)) return fail("Unbekannte Aktion.");
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
    const ctx: ActionCtx = { sb, ops, user: user.name || user.email || "Mitarbeiter", shadow: await isShadow(sb) };

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
