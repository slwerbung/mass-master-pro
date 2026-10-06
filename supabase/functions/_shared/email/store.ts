// Supabase-Gegenstuecke zu den Schnittstellen in sync.ts und understand.ts.

import type { FeedbackExample, RuleRow } from "./classify.ts";
import type { MessageInsert, SyncStore } from "./sync.ts";
import type { PendingMessage, UnderstandStore } from "./understand.ts";
import { MAX_ATTEMPTS } from "./understand.ts";
import type { ActionStore, SuggestionRow } from "./action.ts";
import type { MatchMessageRow, MatchSave, MatchStore } from "./matchStage.ts";
import type { ActMessage, ActStore } from "./act.ts";
import type { DraftStore, DraftThreadMail } from "./draft.ts";
import { buildUploadItems } from "./attachments.ts";
import { getConfig } from "./config.ts";


const BUCKET = "email-attachments";

function must<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.data;
}

export function syncStore(sb: any): SyncStore {
  return {
    async findThread(accountId, messageIds) {
      const { data } = await sb.from("email_messages").select("thread_id, message_id")
        .eq("account_id", accountId).in("message_id", messageIds).not("thread_id", "is", null);
      if (!data?.length) return null;
      // messageIds ist „neueste zuerst": den ersten Treffer in dieser Reihenfolge nehmen.
      for (const id of messageIds) {
        const hit = data.find((r: any) => r.message_id === id);
        if (hit) return { id: hit.thread_id };
      }
      return null;
    },
    async createThread(row) {
      return must(await sb.from("email_threads").insert(row).select("id").single());
    },
    async touchThread(id, patch) {
      must(await sb.from("email_threads").update(patch).eq("id", id));
    },
    async insertMessage(row: MessageInsert) {
      // Doppelte (gleiche Message-ID im Postfach) ueberspringen statt scheitern.
      const { data, error } = await sb.from("email_messages")
        .upsert(row, { onConflict: "account_id,message_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(error.message);
      return data?.length ? { id: data[0].id } : null;
    },
    async insertAttachment(row) {
      must(await sb.from("email_attachments").insert(row));
    },
    async uploadAttachment(path, bytes, mime) {
      const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw new Error(`Anhang-Upload: ${error.message}`);
    },
    async saveCursor(accountId, patch) {
      must(await sb.from("email_accounts").update(patch).eq("id", accountId));
    },
  };
}

export function understandStore(sb: any): UnderstandStore {
  return {
    async loadPending(accountId, limit): Promise<PendingMessage[]> {
      const { data } = await sb.from("email_messages")
        .select("id, account_id, direction, from_addr, from_name, to_addrs, subject, sent_at, body_text, headers, attempts, status")
        .eq("account_id", accountId).in("status", ["neu", "fehler"]).lt("attempts", MAX_ATTEMPTS)
        .order("sent_at", { ascending: true, nullsFirst: false }).limit(limit);
      return (data || []) as PendingMessage[];
    },
    async loadAttachments(messageId) {
      const { data } = await sb.from("email_attachments").select("id, filename, mime, size").eq("message_id", messageId);
      return data || [];
    },
    async saveUnderstanding(id, patch) {
      must(await sb.from("email_messages").update({ ...patch, processed_at: new Date().toISOString() }).eq("id", id));
    },
    async setAttachmentRoles(messageId, roles) {
      for (const r of roles) {
        await sb.from("email_attachments").update({ role: r.role }).eq("message_id", messageId).eq("filename", r.filename);
      }
    },
    async markError(id, attempts, error) {
      must(await sb.from("email_messages").update({ status: "fehler", attempts, error }).eq("id", id));
    },
    async saveShadow(messageId, task, row) {
      await sb.from("email_ai_shadow").upsert({ message_id: messageId, task, ...row }, { onConflict: "message_id,task" });
    },
  };
}

export async function loadRules(sb: any): Promise<RuleRow[]> {
  const { data } = await sb.from("email_rules").select("id, pattern, category, target_folder, protect");
  return data || [];
}

export async function loadExamples(sb: any, n = 20): Promise<FeedbackExample[]> {
  const { data } = await sb.from("email_feedback").select("field, old_value, new_value, from_addr")
    .order("created_at", { ascending: false }).limit(n);
  return (data || []).map((r: any) => ({ field: r.field, old_value: r.old_value, new_value: r.new_value, from: r.from_addr ?? undefined }));
}

export async function recordRun(sb: any, row: Record<string, unknown>): Promise<void> {
  await sb.from("email_runs").insert({ finished_at: new Date().toISOString(), ...row });
}

/** Postfach-Lock: gibt das Postfach nur zurueck, wenn es gerade niemand bearbeitet. */
export async function claimAccount(sb: any, id: string, minutes = 4): Promise<any | null> {
  const now = new Date();
  const until = new Date(now.getTime() + minutes * 60_000).toISOString();
  const { data } = await sb.from("email_accounts").update({ locked_until: until })
    .eq("id", id).or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`).select("*");
  return data?.[0] ?? null;
}

export async function releaseAccount(sb: any, id: string, patch: Record<string, unknown> = {}): Promise<void> {
  await sb.from("email_accounts").update({ locked_until: null, ...patch }).eq("id", id);
}

// ---------------------------------------------------------------------------
// Zuordnen und Handeln (Phase 2)
// ---------------------------------------------------------------------------

export function matchStore(sb: any): MatchStore {
  return {
    async loadForMatch(accountId, limit): Promise<MatchMessageRow[]> {
      const { data } = await sb.from("email_messages")
        .select("id, account_id, thread_id, direction, from_addr, to_addrs, cc_addrs, subject, body_text, summary, attempts")
        .eq("account_id", accountId).eq("status", "klassifiziert")
        .order("sent_at", { ascending: true, nullsFirst: false }).limit(limit);
      return (data || []) as MatchMessageRow[];
    },
    async saveMatch(id, patch: MatchSave) {
      must(await sb.from("email_messages").update(patch).eq("id", id));
    },
    async setThreadProject(threadId, projectId) {
      must(await sb.from("email_threads").update({ hero_project_match_id: projectId }).eq("id", threadId));
      // Fruehere Mails des Threads ohne Zuordnung ziehen mit.
      await sb.from("email_messages").update({ hero_project_match_id: projectId, match_method: "thread" })
        .eq("thread_id", threadId).is("hero_project_match_id", null);
    },
  };
}

const ACT_COLUMNS =
  "id, account_id, thread_id, direction, current_folder, current_uid, from_addr, from_name, to_addrs, subject, category, confidence, " +
  "summary, extracted, hero_project_match_id, match_method, match_info, hero_logged_at, has_attachments, plan, status, attempts, " +
  "message_id, refs, body_text, sent_at, draft_message_id, draft_text, draft_uid, beleg_state";

export function actStore(sb: any): ActStore {
  return {
    async loadActable(accountId, limit): Promise<ActMessage[]> {
      const { data } = await sb.from("email_messages").select(ACT_COLUMNS)
        .eq("account_id", accountId).in("status", ["zugeordnet", "ohne_bezug"])
        .order("sent_at", { ascending: true, nullsFirst: false }).limit(limit);
      return (data || []) as ActMessage[];
    },
    async save(id, patch) {
      must(await sb.from("email_messages").update({ ...patch, processed_at: new Date().toISOString() }).eq("id", id));
    },
    async progress(id, patch) {
      must(await sb.from("email_messages").update(patch).eq("id", id));
    },
    async createSuggestion(messageId, type, payload) {
      // Der partielle Unique-Index (message_id, type) where offen verhindert Dubletten.
      const { error } = await sb.from("email_suggestions").insert({ message_id: messageId, type, payload });
      if (error) {
        if (String(error.code) === "23505") return false;
        throw new Error(error.message);
      }
      return true;
    },
    async hasOpenSuggestions(messageId) {
      const { count } = await sb.from("email_suggestions").select("id", { count: "exact", head: true })
        .eq("message_id", messageId).eq("status", "offen");
      return (count ?? 0) > 0;
    },
    async setBelegState(id, state, vendor) {
      must(await sb.from("email_messages").update({ beleg_state: state, beleg_vendor: vendor }).eq("id", id));
    },
    async hasOutgoingAfter(threadId, sentAt) {
      let q = sb.from("email_messages").select("id", { count: "exact", head: true }).eq("thread_id", threadId).eq("direction", "out");
      if (sentAt) q = q.gt("sent_at", sentAt);
      const { count } = await q;
      return (count ?? 0) > 0;
    },
    async loadAttachments(messageId) {
      const { data } = await sb.from("email_attachments").select("id, filename, mime, size, role, storage_path, is_ignored, hero_uploaded_at").eq("message_id", messageId);
      return data || [];
    },
    async unansweredIncoming(threadId): Promise<ActMessage[]> {
      const { data } = await sb.from("email_messages").select(ACT_COLUMNS)
        .eq("thread_id", threadId).eq("direction", "in").not("hero_project_match_id", "is", null);
      return (data || []) as ActMessage[];
    },
  };
}

// ---------------------------------------------------------------------------
// Vorschlaege ausfuehren (email-action)
// ---------------------------------------------------------------------------

export function actionStore(sb: any): ActionStore {
  return {
    ...actionStoreExtras(sb),
    async getSuggestion(id): Promise<SuggestionRow | null> {
      const { data } = await sb.from("email_suggestions")
        .select("id, message_id, type, payload, status, email_messages!inner(id, account_id, thread_id, direction, from_addr, from_name, to_addrs, subject, summary, has_attachments, hero_project_match_id, hero_logged_at, match_info, email_accounts(label, address))")
        .eq("id", id).maybeSingle();
      if (!data) return null;
      const m = data.email_messages;
      return {
        id: data.id, message_id: data.message_id, type: data.type, payload: data.payload, status: data.status,
        message: { ...m, account_label: m.email_accounts?.label || m.email_accounts?.address || "", email_accounts: undefined },
      };
    },
    async claim(id) {
      const { data } = await sb.from("email_suggestions")
        .update({ status: "angenommen", decided_at: new Date().toISOString() })
        .eq("id", id).in("status", ["offen", "fehlgeschlagen"]).select("id");
      return !!data?.length;
    },
    async finish(id, status, result) {
      must(await sb.from("email_suggestions").update({ status, result, decided_at: new Date().toISOString() }).eq("id", id));
    },
    async assignProject(messageId, threadId, projectId, info) {
      const { data: cur } = await sb.from("email_messages").select("match_info").eq("id", messageId).maybeSingle();
      must(await sb.from("email_messages").update({
        hero_project_match_id: projectId, match_method: "manuell", match_info: { ...(cur?.match_info ?? {}), ...info },
      }).eq("id", messageId));
      if (threadId) {
        must(await sb.from("email_threads").update({ hero_project_match_id: projectId }).eq("id", threadId));
        await sb.from("email_messages").update({ hero_project_match_id: projectId, match_method: "thread" })
          .eq("thread_id", threadId).is("hero_project_match_id", null);
      }
    },
    async markLogged(messageId) {
      must(await sb.from("email_messages").update({ hero_logged_at: new Date().toISOString() }).eq("id", messageId));
    },
    async openCount(messageId) {
      const { count } = await sb.from("email_suggestions").select("id", { count: "exact", head: true })
        .eq("message_id", messageId).eq("status", "offen");
      return count ?? 0;
    },
    async setMessageStatus(messageId, status) {
      must(await sb.from("email_messages").update({ status }).eq("id", messageId));
    },
    async addFeedback(messageId, field, oldValue, newValue) {
      const { data } = await sb.from("email_messages").select("from_addr").eq("id", messageId).maybeSingle();
      await sb.from("email_feedback").insert({ message_id: messageId, field, old_value: oldValue, new_value: newValue, from_addr: data?.from_addr ?? null });
    },
    async dropContactCache(email) {
      await sb.from("hero_contact_cache").delete().eq("email", email.toLowerCase());
    },
  };
}

// ---------------------------------------------------------------------------
// Entwuerfe und Anhaenge (Phase 3)
// ---------------------------------------------------------------------------

export function draftStore(sb: any): DraftStore {
  return {
    async loadThread(threadId, n): Promise<DraftThreadMail[]> {
      const { data } = await sb.from("email_messages").select("direction, from_addr, from_name, sent_at, body_text")
        .eq("thread_id", threadId).order("sent_at", { ascending: false, nullsFirst: false }).limit(n);
      return (data || []).reverse().map((r: any) => ({
        direction: r.direction, from: r.from_name || r.from_addr, sentAt: r.sent_at, body: r.body_text ?? "",
      }));
    },
    async save(messageId, patch) {
      must(await sb.from("email_messages").update(patch).eq("id", messageId));
    },
  };
}


export function actionStoreExtras(sb: any): Pick<ActionStore, "attachmentFiles" | "markUploaded" | "suggestUploads"> {
  return {
    async attachmentFiles(messageId, ids) {
      const { data } = await sb.from("email_attachments").select("id, filename, mime, storage_path")
        .eq("message_id", messageId).in("id", ids).not("storage_path", "is", null);
      return data || [];
    },
    async markUploaded(attachmentId, uploadId) {
      must(await sb.from("email_attachments").update({ hero_file_upload_id: uploadId, hero_uploaded_at: new Date().toISOString() }).eq("id", attachmentId));
    },
    async suggestUploads(messageId, projectId, projectNr) {
      const hero = await getConfig<any>(sb, "hero", {});
      const { data } = await sb.from("email_attachments").select("id, filename, mime, size, role, storage_path, is_ignored, hero_uploaded_at").eq("message_id", messageId);
      const items = buildUploadItems(data || [], hero.document_types ?? {});
      if (!items.length) return;
      // Der Unique-Index (message_id, type) where offen verhindert Dubletten.
      await sb.from("email_suggestions").insert({ message_id: messageId, type: "upload_attachments", payload: { projectId, projectNr, items } });
    },
  };
}
