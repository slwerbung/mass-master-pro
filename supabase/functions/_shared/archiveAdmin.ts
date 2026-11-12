// Spec E: Admin-Aktionen „Archiv & Speicher“ (aus admin-manage). Schreibt NUR app_config.archive_settings
// (kein generischer app_config-Write) und löscht verwaiste Dateien nur auf ausdrücklichen Klick.
import { compactionDue, DEFAULT_ARCHIVE_SETTINGS, mergeArchiveSettings, printPurgeDue, validateArchiveSettings } from "./archive.ts";

type Json = (data: unknown, status?: number) => Response;
const BUCKET = "project-files";
const DAY = 86400000;

async function loadSettings(sb: any) {
  const { data } = await sb.from("app_config").select("value").eq("key", "archive_settings").maybeSingle();
  return mergeArchiveSettings(data?.value ?? null);
}

/** Öffentlich: nur der Kundenzugriff und die Kontaktdaten für „Projekt abgeschlossen“. */
export async function archivePolicy(sb: any) {
  const s = await loadSettings(sb);
  const { data } = await sb.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
  let info: any = {};
  try { info = JSON.parse(data?.value || "{}") || {}; } catch { info = {}; }
  return { customerAccessArchived: s.customerAccessArchived, contact: { name: info.companyName || "", phone: info.phone || "", email: info.email || "" } };
}

/** null = Aktion gehört nicht hierher. */
export async function handleArchiveAction(sb: any, action: string, params: any, json: Json): Promise<Response | null> {
  switch (action) {
    case "get_archive_settings":
      return json({ settings: await loadSettings(sb), defaults: DEFAULT_ARCHIVE_SETTINGS });

    case "set_archive_settings": {
      const r = validateArchiveSettings(params.settings);
      if (r.ok === false) return json({ error: r.error }, 400);
      const { error } = await sb.from("app_config").upsert({ key: "archive_settings", value: JSON.stringify(r.settings) });
      if (error) return json({ error: error.message }, 500);
      return json({ success: true, settings: r.settings });
    }

    case "archive_preview": {
      // Mit den (ggf. noch nicht gespeicherten) Einstellungen: wie viele würden archiviert / komprimiert?
      const s = params.settings ? mergeArchiveSettings(params.settings) : await loadSettings(sb);
      const now = Date.now();
      const [{ data: act }, { data: projects }] = await Promise.all([
        sb.rpc("projects_with_activity"),
        sb.from("projects").select("id, project_number, archived_at, compacted_at, print_files_purged_at, archive_pinned"),
      ]);
      const lastAct = new Map<string, string>((act || []).map((r: any) => [r.id, r.last_activity_at]));
      const all = (projects || []) as any[];
      const wouldArchive = s.autoArchiveDays > 0
        ? all.filter((p) => !p.archived_at && !p.archive_pinned && lastAct.get(p.id) && now - Date.parse(lastAct.get(p.id)!) > s.autoArchiveDays * DAY)
        : [];
      const wouldCompact = all.filter((p) => compactionDue(p, s, now));
      const wouldPurge = all.filter((p) => printPurgeDue(p, s, now));
      return json({
        archive: wouldArchive.map((p) => ({ id: p.id, projectNumber: p.project_number })),
        compact: wouldCompact.map((p) => ({ id: p.id, projectNumber: p.project_number, archivedAt: p.archived_at })),
        purgePrint: wouldPurge.map((p) => ({ id: p.id, projectNumber: p.project_number })),
      });
    }

    case "storage_stats": {
      const [{ data: objs, error }, { data: projects }, { data: orphans }] = await Promise.all([
        sb.rpc("storage_objects_report"),
        sb.from("projects").select("id, archived_at, compacted_at"),
        sb.rpc("storage_orphans"),
      ]);
      if (error) return json({ error: error.message }, 500);
      const state = new Map<string, "active" | "archived" | "compacted">();
      for (const p of (projects || []) as any[]) state.set(p.id, p.compacted_at ? "compacted" : p.archived_at ? "archived" : "active");
      const orphanSet = new Set(((orphans || []) as any[]).map((o) => o.name));
      const folders = new Map<string, { folder: string; active: number; archived: number; compacted: number; other: number; orphan: number; total: number; count: number }>();
      let total = 0;
      for (const o of (objs || []) as any[]) {
        const folder = String(o.name).split("/")[0];
        const f = folders.get(folder) ?? folders.set(folder, { folder, active: 0, archived: 0, compacted: 0, other: 0, orphan: 0, total: 0, count: 0 }).get(folder)!;
        const size = Number(o.size) || 0;
        f.total += size; f.count++; total += size;
        if (orphanSet.has(o.name)) f.orphan += size;
        else if (o.project_id && state.has(o.project_id)) f[state.get(o.project_id)!] += size;
        else f.other += size;
      }
      return json({ total, folders: [...folders.values()].sort((a, b) => b.total - a.total), orphanBytes: [...folders.values()].reduce((n, f) => n + f.orphan, 0) });
    }

    case "storage_orphans_report": {
      const { data, error } = await sb.rpc("storage_orphans");
      if (error) return json({ error: error.message }, 500);
      const groups = new Map<string, { folder: string; count: number; bytes: number; files: { name: string; size: number; createdAt: string }[] }>();
      for (const o of (data || []) as any[]) {
        const g = groups.get(o.folder) ?? groups.set(o.folder, { folder: o.folder, count: 0, bytes: 0, files: [] }).get(o.folder)!;
        g.count++; g.bytes += Number(o.size) || 0;
        if (g.files.length < 50) g.files.push({ name: o.name, size: Number(o.size) || 0, createdAt: o.created_at });
      }
      return json({ groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes) });
    }

    case "storage_orphans_delete": {
      // Nur die im Bericht (frisch berechnet) genannten Objekte der gewählten Ordner.
      const prefixes = (Array.isArray(params.prefixes) ? params.prefixes : []).map(String).filter(Boolean);
      if (!prefixes.length) return json({ error: "Keine Ordner gewählt." }, 400);
      const { data, error } = await sb.rpc("storage_orphans");
      if (error) return json({ error: error.message }, 500);
      const victims = ((data || []) as any[]).filter((o) => prefixes.includes(o.folder));
      let deleted = 0, bytes = 0;
      for (let i = 0; i < victims.length; i += 100) {
        const chunk = victims.slice(i, i + 100);
        const { error: rmErr } = await sb.storage.from(BUCKET).remove(chunk.map((o) => o.name));
        if (rmErr) return json({ error: rmErr.message, deleted, bytes }, 500);
        await sb.from("storage_compaction_log").insert(chunk.map((o) => ({
          project_id: null, storage_path: o.name, action: "delete_orphan", bytes_before: Number(o.size) || 0, bytes_after: 0, dry_run: false,
        })));
        deleted += chunk.length;
        bytes += chunk.reduce((n, o) => n + (Number(o.size) || 0), 0);
      }
      return json({ success: true, deleted, bytes });
    }

    case "compaction_log": {
      const { data, error } = await sb.from("storage_compaction_log")
        .select("id, project_id, storage_path, action, bytes_before, bytes_after, dry_run, error, created_at, projects(project_number)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) return json({ error: error.message }, 500);
      return json({ entries: data || [] });
    }
  }
  return null;
}
