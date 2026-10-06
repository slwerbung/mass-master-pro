// Supabase-Gegenstuecke zu den Schnittstellen in sync.ts und understand.ts.

import type { FeedbackExample, RuleRow } from "./classify.ts";
import type { MessageInsert, SyncStore } from "./sync.ts";
import type { PendingMessage, UnderstandStore } from "./understand.ts";
import { MAX_ATTEMPTS } from "./understand.ts";

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
