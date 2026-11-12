// Spec E: Archivieren/Reaktivieren/Anpinnen über project-team (nicht mehr per Direkt-Update) + öffentliche Archivregeln.
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

export async function projectArchiveAction(action: "archive" | "unarchive" | "set_pinned", projectId: string, pinned?: boolean) {
  const { data, error } = await supabase.functions.invoke("project-team", {
    body: { token: getSession()?.authToken, action, projectId, pinned },
  });
  if (error) {
    const msg = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null);
    throw new Error(msg || data?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data?.project as { id: string; archived_at: string | null; archive_pinned: boolean; compacted_at: string | null } | undefined;
}

export interface ArchivePolicy {
  customerAccessArchived: "readonly" | "full" | "none";
  autoArchiveDays: number;
  warnDaysBefore: number;
  contact: { name: string; phone: string; email: string };
}

let cached: Promise<ArchivePolicy | null> | null = null;
export function getArchivePolicy(): Promise<ArchivePolicy | null> {
  if (!cached) {
    cached = supabase.functions.invoke("admin-manage", { body: { action: "get_archive_policy" } })
      .then(({ data }) => (data && !data.error ? (data as ArchivePolicy) : null))
      .catch(() => null);
  }
  return cached;
}

/** Tage bis zum automatischen Archivieren (Vorwarnung in der Liste); null = keine Warnung. */
export function daysUntilArchive(lastActivity: string | null | undefined, autoArchiveDays: number, pinned: boolean, now = Date.now()): number | null {
  if (pinned || !autoArchiveDays || !lastActivity) return null;
  return Math.ceil((Date.parse(lastActivity) + autoArchiveDays * 86400000 - now) / 86400000);
}
