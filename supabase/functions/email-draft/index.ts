// Antwortentwurf erzeugen, neu erzeugen, bearbeiten und ins Postfach legen (Aufruf aus der Mail-App).
//
//   { action: "generate", messageId, hint?, write? }   Entwurf (neu) erzeugen; `write`: ins Postfach legen
//   { action: "save", messageId, text, subject?, write? }  bearbeiteten Text speichern (ersetzt den Postfach-Entwurf)
//   { action: "write", messageId }                      gespeicherten Entwurf ins Postfach legen
//
// Der Entwurf wird NIE gesendet, nur im Entwuerfe-Ordner abgelegt. Ein ueberholter Entwurf
// wandert in den Papierkorb (kein Loeschen).

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { accountPassword, buildLlmDeps, getConfig } from "../_shared/email/config.ts";
import { generateDraft, replySubject, type DraftMsg } from "../_shared/email/draft.ts";
import { imapDraftWriter } from "../_shared/email/draftMime.ts";
import { projectDraftContext, loadHeroKey } from "../_shared/email/hero.ts";
import { LazyImap } from "../_shared/email/lazyImap.ts";
import { draftStore } from "../_shared/email/store.ts";

const COMPANY_NAME = "SL WERBUNG";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await requireAdmin(req, sb))) return fail("Nicht angemeldet oder keine Admin-Rolle.", { code: "unauthorized" });

  const body = await readJson(req);
  if (!["generate", "save", "write"].includes(body.action)) return fail("Unbekannte Aktion.");

  let imap: LazyImap | null = null;
  try {
    const { data: m } = await sb.from("email_messages")
      .select("id, account_id, thread_id, direction, from_addr, from_name, subject, message_id, refs, sent_at, body_text, category, summary, extracted, hero_project_match_id, draft_message_id, draft_text, draft_subject, draft_uid")
      .eq("id", String(body.messageId || "")).maybeSingle();
    if (!m) return fail("Mail nicht gefunden.");
    if (m.direction !== "in") return fail("Für ausgehende Mails gibt es keinen Entwurf.");
    const { data: acc } = await sb.from("email_accounts").select("*").eq("id", m.account_id).maybeSingle();
    if (!acc) return fail("Postfach nicht gefunden.");

    const fm = acc.folder_map || {};
    const wantWrite = body.action === "write" || body.write === true;
    if (wantWrite && !fm.drafts) return fail("Für dieses Postfach ist kein Entwürfe-Ordner bekannt (Einstellungen → Postfächer → „Ordner anlegen & speichern“).");

    const store = draftStore(sb);
    let writer = null;
    if (wantWrite) {
      imap = new LazyImap({ host: acc.imap_host, port: acc.imap_port, user: acc.username, pass: await accountPassword(acc) });
      const lazy = imap;
      writer = imapDraftWriter(() => lazy.raw(), { drafts: fm.drafts, trash: fm.trash ?? null, fromName: COMPANY_NAME, fromAddress: acc.address });
    }
    const msg = m as DraftMsg & { draft_uid: number | null; draft_subject: string | null };

    if (body.action === "generate") {
      const heroKey = await loadHeroKey(sb);
      const [knowledge, replyRules, llm] = await Promise.all([
        getConfig<string>(sb, "company_knowledge", ""), getConfig<string>(sb, "reply_rules", ""), buildLlmDeps(sb),
      ]);
      const r = await generateDraft(msg, {
        llm, store, writer, knowledge, replyRules, signature: acc.signature || "",
        heroContext: heroKey ? (pid) => projectDraftContext(heroKey, pid) : null,
      }, { write: wantWrite, hint: body.hint ? String(body.hint) : undefined });
      return ok(r);
    }

    // save / write: gespeicherten (oder vom Menschen bearbeiteten) Text verwenden
    const text = body.action === "save" ? String(body.text ?? "").trim() : String(msg.draft_text ?? "");
    if (!text) return fail("Es gibt noch keinen Entwurf – bitte zuerst erzeugen.");
    const subject = String(body.subject || msg.draft_subject || replySubject(msg.subject)).slice(0, 300);
    await store.save(msg.id, { draft_text: text, draft_subject: subject });
    // Wurde schon einer ins Postfach geschrieben, ersetzt die Bearbeitung ihn.
    const replace = wantWrite || !!msg.draft_message_id;
    if (replace) {
      if (!writer) {
        if (!fm.drafts) return ok({ text, subject, written: false });
        imap = new LazyImap({ host: acc.imap_host, port: acc.imap_port, user: acc.username, pass: await accountPassword(acc) });
        const lazy = imap;
        writer = imapDraftWriter(() => lazy.raw(), { drafts: fm.drafts, trash: fm.trash ?? null, fromName: COMPANY_NAME, fromAddress: acc.address });
      }
      const w = await writer.write(msg, subject, text, msg.draft_message_id, msg.draft_uid ?? null);
      await store.save(msg.id, { draft_message_id: w.messageId, draft_uid: w.uid, draft_written_at: new Date().toISOString() });
      return ok({ text, subject, written: true });
    }
    return ok({ text, subject, written: false });
  } catch (e) {
    return fail(`Fehler: ${String((e as Error)?.message || e).slice(0, 300)}`);
  } finally {
    await imap?.close();
  }
});
