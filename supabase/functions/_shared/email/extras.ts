// Phase 3: Entwurf und Anhaenge als Erweiterung der Stufe „Handeln" (siehe act.ts, `extra`).

import { decide } from "./autopilot.ts";
import { matchConfidence, type ActContext, type ActDeps, type ActMessage, type PlanEntry } from "./act.ts";
import { buildUploadItems, type DocTypes } from "./attachments.ts";
import { generateDraft, shouldDraft, LimitWaitError, type DraftDeps, type DraftMsg } from "./draft.ts";

export interface ExtraConfig {
  docTypes: DocTypes;
  /** `canWrite`: Entwuerfe-Ordner bekannt und IMAP verfuegbar. */
  draft: { deps: DraftDeps; canWrite: boolean } | null;
}

function toDraftMsg(m: ActMessage): DraftMsg & { draft_uid: number | null } {
  return {
    id: m.id, account_id: m.account_id, thread_id: m.thread_id, direction: m.direction, from_addr: m.from_addr, from_name: m.from_name,
    subject: m.subject, message_id: m.message_id ?? "", refs: m.refs ?? [], sent_at: m.sent_at ?? null, body_text: m.body_text ?? null,
    category: m.category, summary: m.summary, extracted: m.extracted, hero_project_match_id: m.hero_project_match_id,
    draft_message_id: m.draft_message_id ?? null, draft_text: m.draft_text ?? null, draft_uid: m.draft_uid ?? null,
  };
}

export function buildExtra(cfg: ExtraConfig): NonNullable<ActContext["extra"]> {
  return async (m: ActMessage, ctx: ActContext, deps: ActDeps, plan: PlanEntry[]) => {
    const certain = m.match_info?.certain === true;

    // ---------------------------------------------------------------- Antwortentwurf
    if (cfg.draft && m.direction === "in" && !m.draft_text) {
      const answered = m.thread_id ? await deps.store.hasOutgoingAfter(m.thread_id, m.sent_at ?? null) : false;
      const sd = shouldDraft(m, { threadAnsweredAfter: answered });
      if (sd.draft) {
        const d = decide("draft", { autopilot: ctx.autopilot, shadowMode: ctx.shadowMode, confidence: m.confidence, certain: false });
        if (d !== "skip") {
          // Auto + nicht Schattenmodus: ins Postfach legen. Sonst nur berechnen und in der Mail-App zeigen.
          const write = d === "auto" && cfg.draft.canWrite;
          try {
            const r = await generateDraft(toDraftMsg(m), cfg.draft.deps, { write });
            plan.push({
              action: "draft", decision: d, done: r.written,
              detail: r.written
                ? `Entwurf im Postfach (${r.placeholders.length} Platzhalter)`
                : d === "shadow" ? "Würde einen Entwurf ins Postfach legen (hier nur angezeigt)" : "Entwurf in der Mail-App – noch nicht im Postfach",
            });
          } catch (e) {
            if (e instanceof LimitWaitError) plan.push({ action: "draft", decision: "skip", done: false, detail: "KI-Kontingent erschöpft – Entwurf bitte in der Mail-App erzeugen" });
            else plan.push({ action: "draft", decision: "skip", done: false, detail: `Entwurf fehlgeschlagen: ${String((e as Error).message).slice(0, 150)}` });
          }
        }
      } else {
        plan.push({ action: "draft", decision: "skip", done: false, detail: `Kein Entwurf: ${sd.reason}` });
      }
    }

    // ---------------------------------------------------------------- Anhaenge ans Projekt
    if (m.hero_project_match_id && m.has_attachments) {
      const d = decide("attachments", { autopilot: ctx.autopilot, shadowMode: ctx.shadowMode, confidence: matchConfidence(m.match_method, certain), certain });
      if (d !== "skip") {
        const items = buildUploadItems(await deps.store.loadAttachments(m.id), cfg.docTypes);
        if (items.length) {
          const projectId = m.hero_project_match_id;
          if (d === "auto" && deps.uploader) {
            const r = await deps.uploader.upload(projectId, items, m.id);
            plan.push({ action: "attachments", decision: d, done: r.uploaded > 0, detail: `${r.uploaded} von ${items.length} hochgeladen${r.failed.length ? `, Fehler: ${r.failed.join("; ")}` : ""}` });
          } else if (d === "shadow") {
            plan.push({ action: "attachments", decision: d, done: false, detail: `Würde ${items.length} Anhang/Anhänge ans Projekt hochladen` });
          } else {
            const created = await deps.store.createSuggestion(m.id, "upload_attachments", { projectId, projectNr: m.match_info?.projectNr ?? null, items });
            plan.push({ action: "attachments", decision: "suggest", done: created, detail: `Vorschlag: ${items.length} Anhang/Anhänge` });
          }
        }
      }
    }
  };
}
