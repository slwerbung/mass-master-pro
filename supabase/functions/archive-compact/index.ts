// Spec E: Archivierte Projekte speicherschonend ablegen. Aufruf: pg_cron (x-poll-secret = app_config.archive_poll_secret)
// oder Admin (adminToken; Testlauf/„Jetzt ausführen“). Body: { projectId?, dryRun?, action?: "run" | "probe" }.
//
// Regeln (siehe _shared/archive.ts):
// - Fotos werden verkleinert und AM SELBEN PFAD ersetzt (ein Schritt, nie ein Verweis auf eine fehlende Datei). Die
//   Mitarbeiter-App lädt Standortfotos über feste Pfade (images/<Standort>/annotated) – ein neuer Pfad wäre dort unsichtbar.
// - Annotierte Bilder nur verkleinern, nie löschen. PDFs/Druckdaten nie neu komprimieren.
// - Freigegebene Pfade (approval_events „approve“, approved_paths) werden NIE gelöscht.
// - Datenbank zuerst, dann Storage: eine Zeile zeigt nie auf eine gelöschte Datei.
// - Zeitbudget 110 s; der nächste Lauf macht weiter. compacted_at erst, wenn alles ohne Fehler durch ist.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import {
  compactionDue, estimateResizedBytes, imageDims, isCompressibleImage, mergeArchiveSettings, needsResize, printPurgeDue,
  protectedPaths, targetSize, type ArchiveSettings,
} from "../_shared/archive.ts";

const BUCKET = "project-files";
const BUDGET_MS = 110_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poll-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type LogRow = { project_id: string | null; storage_path: string; action: string; bytes_before: number | null; bytes_after: number | null; dry_run: boolean; error?: string | null };
interface Photo { path: string; role: "annotated" | "original" | "other"; dropOriginal?: () => Promise<void>; hasAnnotated?: boolean }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  // ---- Zugang: Cron-Secret oder Admin
  const secret = req.headers.get("x-poll-secret");
  let allowed = false;
  if (secret) {
    const { data } = await sb.from("app_config").select("value").eq("key", "archive_poll_secret").maybeSingle();
    allowed = !!data?.value && data.value === secret;
  } else if (body.adminToken) {
    const p = await verifySessionToken(String(body.adminToken), getSessionSecret()).catch(() => null);
    allowed = !!p && p.role === "admin" && p.userId === "admin";
  }
  if (!allowed) return json({ error: "Unauthorized" }, 401);

  const { data: cfg } = await sb.from("app_config").select("value").eq("key", "archive_settings").maybeSingle();
  const settings = mergeArchiveSettings(cfg?.value ?? null);
  const dryRun = body.dryRun === true;
  const timeLeft = () => BUDGET_MS - (Date.now() - started);

  // Objektgrößen einmal laden
  const { data: objs, error: oErr } = await sb.rpc("storage_objects_report");
  if (oErr) return json({ error: "Speicherliste nicht lesbar: " + oErr.message }, 500);
  const objects = new Map<string, { size: number; project_id: string | null }>();
  for (const o of (objs || []) as any[]) objects.set(o.name, { size: Number(o.size) || 0, project_id: o.project_id });

  if (body.action === "probe") return json(await probe(sb, objects, settings));

  // ---- Kandidaten
  let projects: any[] = [];
  const cols = "id, project_number, archived_at, compacted_at, print_files_purged_at";
  if (body.projectId) {
    const { data: p } = await sb.from("projects").select(cols).eq("id", String(body.projectId)).maybeSingle();
    if (!p) return json({ error: "Projekt nicht gefunden." }, 404);
    if (!p.archived_at) return json({ error: "Nur archivierte Projekte werden komprimiert." }, 400);
    projects = [p];
  } else {
    const { data } = await sb.from("projects").select(cols).not("archived_at", "is", null).order("archived_at", { ascending: true });
    projects = (data || []).filter((p: any) => compactionDue(p, settings) || printPurgeDue(p, settings));
  }

  const results: any[] = [];
  let partial = false;
  for (const p of projects) {
    if (timeLeft() < 8000) { partial = true; break; }
    const forced = !!body.projectId;
    const r = await processProject(sb, p, settings, objects, { dryRun, timeLeft, compact: forced || compactionDue(p, settings), purgePrint: printPurgeDue(p, settings) });
    results.push(r);
    if (r.partial) { partial = true; break; }
  }
  const sum = (k: string) => results.reduce((n, r) => n + (r[k] || 0), 0);
  return json({ ok: true, dryRun, partial, projects: results, bytesBefore: sum("bytesBefore"), bytesAfter: sum("bytesAfter"), saved: sum("bytesBefore") - sum("bytesAfter"), engine: engineUsed });
});

// ------------------------------------------------------------------ Bildverkleinerung
let engineUsed: "transform" | "none" | null = null;

/**
 * Verkleinert über Supabase Storage Image Transformation (läuft beim Anbieter, kostet keine CPU der Function).
 * Ohne diese Funktion im Tarif bleibt das Bild unverändert (Ergebnis null) – kein Neukodieren in der Function,
 * weil das bei großen Fotos das CPU-Limit sprengt.
 */
async function resizeViaTransform(sb: any, path: string, dims: { w: number; h: number }, s: ArchiveSettings): Promise<Uint8Array | null> {
  if (engineUsed === "none") return null;
  const t = targetSize(dims, s.imageMaxPx);
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 120, { transform: { width: t.w, height: t.h, resize: "contain", quality: s.imageQuality } });
  if (error || !data?.signedUrl) { engineUsed = "none"; return null; }
  const r = await fetch(data.signedUrl);
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || !ct.startsWith("image/")) { engineUsed = "none"; await r.body?.cancel(); return null; }
  engineUsed = "transform";
  return new Uint8Array(await r.arrayBuffer());
}

async function download(sb: any, path: string): Promise<Uint8Array | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function probe(sb: any, objects: Map<string, { size: number }>, s: ArchiveSettings) {
  const cand = [...objects.entries()].filter(([n, o]) => n.startsWith("images/") && o.size > 400 * 1024).sort((a, b) => b[1].size - a[1].size)[0];
  if (!cand) return { ok: true, note: "kein großes Foto gefunden" };
  const bytes = await download(sb, cand[0]);
  const dims = bytes ? imageDims(bytes) : null;
  if (!bytes || !dims) return { ok: true, path: cand[0], note: "kein lesbares Bild" };
  const out = await resizeViaTransform(sb, cand[0], dims, s);
  return { ok: true, path: cand[0], bytes: bytes.length, dims, engine: engineUsed, transformed: out ? { bytes: out.length, dims: imageDims(out) } : null };
}

// ------------------------------------------------------------------ Projekt verarbeiten
async function processProject(
  sb: any, p: any, s: ArchiveSettings, objects: Map<string, { size: number; project_id: string | null }>,
  o: { dryRun: boolean; timeLeft: () => number; compact: boolean; purgePrint: boolean },
) {
  const log: LogRow[] = [];
  const res = { id: p.id, projectNumber: p.project_number, bytesBefore: 0, bytesAfter: 0, actions: 0, errors: 0, partial: false, done: false };
  const add = (path: string, action: string, before: number | null, after: number | null, error?: string) => {
    log.push({ project_id: p.id, storage_path: path, action, bytes_before: before, bytes_after: after, dry_run: o.dryRun, error: error ?? null });
    if (action === "error") { res.errors++; return; }
    res.actions++;
    res.bytesBefore += before || 0;
    res.bytesAfter += after || 0;
  };
  const size = (path: string) => objects.get(path)?.size ?? null;
  const removeStorage = async (paths: string[]) => {
    if (!paths.length) return;
    const { error } = await sb.storage.from(BUCKET).remove(paths);
    if (error) throw new Error(error.message);
  };

  try {
    const { data: locs } = await sb.from("locations").select("id").eq("project_id", p.id);
    const locIds = (locs || []).map((l: any) => l.id);
    const none = ["00000000-0000-0000-0000-000000000000"];
    const ids = locIds.length ? locIds : none;
    const [li, di, vi, vm, fp, cu, lp, vl, ev, la, va, mn] = await Promise.all([
      sb.from("location_images").select("id, location_id, image_type, storage_path").in("location_id", ids),
      sb.from("detail_images").select("id, annotated_path, original_path").in("location_id", ids),
      sb.from("vehicle_images").select("id, storage_path").eq("project_id", p.id),
      sb.from("vehicle_measured_images").select("id, storage_path, original_storage_path").eq("project_id", p.id),
      sb.from("floor_plans").select("id, storage_path").eq("project_id", p.id),
      sb.from("customer_uploads").select("id, storage_path").eq("project_id", p.id),
      sb.from("location_pdfs").select("id, storage_path, superseded_at").in("location_id", ids),
      sb.from("vehicle_layouts").select("id, storage_path, superseded_at").eq("project_id", p.id),
      sb.from("approval_events").select("action, storage_paths").eq("project_id", p.id),
      sb.from("location_approvals").select("approved_paths").in("location_id", ids),
      sb.from("vehicle_layout_approval").select("approved_paths").eq("project_id", p.id),
      sb.from("meeting_notes").select("id").eq("project_id", p.id).not("transcript", "is", null).limit(1),
    ]);
    const keep = protectedPaths(ev.data || [], [...(la.data || []), ...(va.data || [])]);

    if (o.compact) {
      // ---- Fotos sammeln
      const photos: Photo[] = [];
      const seen = new Set<string>();
      const push = (ph: Photo) => { if (ph.path && !seen.has(ph.path) && objects.has(ph.path)) { seen.add(ph.path); photos.push(ph); } };
      for (const id of locIds) {
        const ann = `images/${id}/annotated`, orig = `images/${id}/original`;
        push({ path: ann, role: "annotated" });
        push({
          path: orig, role: "original", hasAnnotated: objects.has(ann),
          dropOriginal: async () => { await sb.from("location_images").delete().eq("location_id", id).eq("image_type", "original"); },
        });
      }
      for (const r of (li.data || []) as any[]) push({ path: r.storage_path, role: r.image_type === "original" ? "original" : "annotated", hasAnnotated: true,
        dropOriginal: async () => { await sb.from("location_images").delete().eq("id", r.id); } });
      for (const r of (di.data || []) as any[]) {
        push({ path: r.annotated_path, role: "annotated" });
        if (r.original_path !== r.annotated_path) push({
          path: r.original_path, role: "original", hasAnnotated: objects.has(r.annotated_path),
          // original_path ist Pflicht: auf das annotierte Bild zeigen lassen (existiert sicher).
          dropOriginal: async () => { await sb.from("detail_images").update({ original_path: r.annotated_path }).eq("id", r.id); },
        });
      }
      for (const r of (vi.data || []) as any[]) push({ path: r.storage_path, role: "other" });
      for (const r of (vm.data || []) as any[]) {
        push({ path: r.storage_path, role: "annotated" });
        if (r.original_storage_path) push({
          path: r.original_storage_path, role: "original", hasAnnotated: objects.has(r.storage_path),
          dropOriginal: async () => { await sb.from("vehicle_measured_images").update({ original_storage_path: null }).eq("id", r.id); },
        });
      }
      for (const r of (fp.data || []) as any[]) push({ path: r.storage_path, role: "other" });
      for (const r of (cu.data || []) as any[]) if (isCompressibleImage(r.storage_path, null)) push({ path: r.storage_path, role: "other" });

      // ---- Originale löschen (nur wenn ein annotiertes Bild existiert und eingestellt)
      if (!s.keepOriginalPhotos) {
        for (const ph of photos.filter((x) => x.role === "original" && x.hasAnnotated && x.dropOriginal && !keep.has(x.path))) {
          if (o.timeLeft() < 5000) { res.partial = true; break; }
          const before = size(ph.path) ?? 0;
          if (o.dryRun) { add(ph.path, "delete_original", before, 0); continue; }
          try { await ph.dropOriginal!(); await removeStorage([ph.path]); add(ph.path, "delete_original", before, 0); objects.delete(ph.path); }
          catch (e) { add(ph.path, "error", before, null, `Original löschen: ${(e as Error).message}`); }
        }
      }

      // ---- Fotos verkleinern (am selben Pfad)
      for (const ph of photos) {
        if (res.partial) break;
        if (o.timeLeft() < 5000) { res.partial = true; break; }
        const before = size(ph.path);
        if (before == null || before < 150 * 1024) continue; // kleine Dateien lohnen nicht
        try {
          const bytes = await download(sb, ph.path);
          const dims = bytes ? imageDims(bytes) : null;
          if (!bytes || !dims) continue; // kein Foto (z. B. PDF als Grundriss)
          if (!needsResize(bytes.length, dims, s.imageMaxPx)) continue;
          if (o.dryRun) { add(ph.path, "resize", before, estimateResizedBytes(before, dims, s.imageMaxPx)); continue; }
          const out = await resizeViaTransform(sb, ph.path, dims, s);
          if (!out) continue; // Transformation im Tarif nicht verfügbar → unverändert
          if (out.length >= before * 0.95) continue;
          const nd = imageDims(out);
          if (!nd || Math.max(nd.w, nd.h) > s.imageMaxPx + 2) throw new Error("verkleinertes Bild unplausibel");
          const ct = out[0] === 0x89 ? "image/png" : out[0] === 0x52 ? "image/webp" : "image/jpeg";
          const { error } = await sb.storage.from(BUCKET).upload(ph.path, new Blob([out as Uint8Array<ArrayBuffer>], { type: ct }), { upsert: true, contentType: ct });
          if (error) throw new Error(error.message);
          add(ph.path, "resize", before, out.length);
        } catch (e) {
          add(ph.path, "error", before, null, `Verkleinern: ${(e as Error).message}`.slice(0, 300));
        }
      }

      // ---- Alte Versionen (außer freigegebenen)
      if (s.purgeSupersededVersions && !res.partial) {
        for (const [table, rows] of [["location_pdfs", lp.data || []], ["vehicle_layouts", vl.data || []]] as const) {
          for (const r of (rows as any[]).filter((x) => x.superseded_at && !keep.has(x.storage_path))) {
            if (o.timeLeft() < 5000) { res.partial = true; break; }
            const before = size(r.storage_path) ?? 0;
            if (o.dryRun) { add(r.storage_path, "delete_version", before, 0); continue; }
            try {
              const { error } = await sb.from(table).delete().eq("id", r.id);
              if (error) throw new Error(error.message);
              await removeStorage([r.storage_path]);
              add(r.storage_path, "delete_version", before, 0);
            } catch (e) { add(r.storage_path, "error", before, null, `Version löschen: ${(e as Error).message}`); }
          }
        }
      }

      // ---- Besprechungs-Audio (nur wenn ein Transkript existiert)
      if (s.deleteMeetingAudio && (mn.data || []).length && !res.partial) {
        const audio = [...objects.keys()].filter((n) => n.startsWith(`meeting-audio/${p.id}/`));
        for (const path of audio) {
          const before = size(path) ?? 0;
          if (o.dryRun) { add(path, "delete_audio", before, 0); continue; }
          try { await removeStorage([path]); add(path, "delete_audio", before, 0); }
          catch (e) { add(path, "error", before, null, `Audio löschen: ${(e as Error).message}`); }
        }
      }
    }

    // ---- Druckdateien entfernen (eigene Frist; freigegebene bleiben)
    if (o.purgePrint && !res.partial) {
      for (const [table, rows] of [["location_pdfs", lp.data || []], ["vehicle_layouts", vl.data || []]] as const) {
        for (const r of (rows as any[]).filter((x) => !keep.has(x.storage_path))) {
          if (o.timeLeft() < 5000) { res.partial = true; break; }
          const before = size(r.storage_path) ?? 0;
          if (o.dryRun) { add(r.storage_path, "delete_print", before, 0); continue; }
          try {
            const { error } = await sb.from(table).delete().eq("id", r.id);
            if (error) throw new Error(error.message);
            await removeStorage([r.storage_path]);
            add(r.storage_path, "delete_print", before, 0);
          } catch (e) { add(r.storage_path, "error", before, null, `Druckdatei löschen: ${(e as Error).message}`); }
        }
      }
      if (!o.dryRun && !res.partial && !res.errors) await sb.from("projects").update({ print_files_purged_at: new Date().toISOString() }).eq("id", p.id);
    }

    if (!o.dryRun && o.compact && !res.partial && !res.errors) {
      await sb.from("projects").update({ compacted_at: new Date().toISOString() }).eq("id", p.id);
      res.done = true;
    }
  } catch (e) {
    add(`project:${p.id}`, "error", null, null, (e as Error).message.slice(0, 300));
  }
  for (let i = 0; i < log.length; i += 200) await sb.from("storage_compaction_log").insert(log.slice(i, i + 200));
  return res;
}
