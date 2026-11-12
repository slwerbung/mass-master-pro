// Spec E: Fotos archivierter Projekte im Browser des Admins verkleinern (die Edge Function darf nicht neu kodieren –
// CPU-Limit, und die Bild-Umrechnung von Supabase ist im Tarif nicht aktiv). Ablauf: archive-compact „image_tasks“
// liefert signierte Download-/Upload-Links → hier verkleinern → am SELBEN Pfad ersetzen → „image_done“ protokolliert.
import { supabase } from "@/integrations/supabase/client";

export interface ImageTask { projectId: string; projectNumber: string; path: string; size: number; downloadUrl: string; uploadToken: string }
export interface ImageResult { path: string; before: number; after?: number; error?: string; skipped?: boolean }

/** Zielmaße: längere Kante höchstens maxPx, nie vergrößern. */
export function fitWithin(w: number, h: number, maxPx: number): { w: number; h: number } {
  const k = Math.min(1, maxPx / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Lohnt sich das Ergebnis? (mind. 5 % kleiner) */
export const worthReplacing = (before: number, after: number) => after < before * 0.95;

async function invokeCompact(adminToken: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("archive-compact", { body: { adminToken, ...body } });
  if (error) {
    const msg = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null);
    throw new Error(msg || data?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function resizeOne(t: ImageTask, maxPx: number, quality: number): Promise<ImageResult> {
  const res = await fetch(t.downloadUrl);
  if (!res.ok) return { path: t.path, before: t.size, error: `Download ${res.status}` };
  const blob = await res.blob();
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return { path: t.path, before: t.size, skipped: true }; } // kein Foto
  const long = Math.max(bmp.width, bmp.height);
  if (long <= maxPx && blob.size <= 400 * 1024) { bmp.close(); return { path: t.path, before: t.size, after: t.size, skipped: true }; }
  const size = fitWithin(bmp.width, bmp.height, maxPx);
  const canvas = document.createElement("canvas");
  canvas.width = size.w; canvas.height = size.h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPEG kennt keine Transparenz
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.drawImage(bmp, 0, 0, size.w, size.h);
  bmp.close();
  const out: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality / 100));
  canvas.width = canvas.height = 0;
  if (!out) return { path: t.path, before: t.size, error: "Kodieren fehlgeschlagen" };
  if (!worthReplacing(blob.size, out.size)) return { path: t.path, before: t.size, after: t.size, skipped: true };
  const { error } = await supabase.storage.from("project-files").uploadToSignedUrl(t.path, t.uploadToken, out, { contentType: "image/jpeg", upsert: true });
  if (error) return { path: t.path, before: t.size, error: error.message };
  return { path: t.path, before: blob.size, after: out.size };
}

/**
 * Alle fälligen Fotos abarbeiten (in Paketen), Fortschritt melden. Abbruch über `signal`.
 * Übersprungene Fotos werden ebenfalls protokolliert (nach = vorher), damit sie nicht erneut geprüft werden.
 */
export async function resizeArchivedPhotos(adminToken: string, opts: { projectId?: string; onProgress?: (p: { done: number; saved: number; errors: number; remaining: number }) => void; signal?: AbortSignal }) {
  let done = 0, saved = 0, errors = 0;
  for (let round = 0; round < 200; round++) {
    if (opts.signal?.aborted) break;
    const batch = await invokeCompact(adminToken, { action: "image_tasks", projectId: opts.projectId, limit: 20 });
    const tasks: ImageTask[] = batch.tasks || [];
    if (!tasks.length) { opts.onProgress?.({ done, saved, errors, remaining: 0 }); break; }
    const results: ImageResult[] = [];
    for (const t of tasks) {
      if (opts.signal?.aborted) break;
      const r = await resizeOne(t, batch.maxPx, batch.quality).catch((e) => ({ path: t.path, before: t.size, error: String(e?.message || e) } as ImageResult));
      results.push(r);
      done++;
      if (r.error) errors++;
      else if (r.after != null) saved += Math.max(0, r.before - r.after);
      opts.onProgress?.({ done, saved, errors, remaining: batch.remaining + tasks.length - results.length });
    }
    await invokeCompact(adminToken, { action: "image_done", items: results.map((r) => ({ path: r.path, before: r.before, after: r.after ?? r.before, error: r.error })) });
    if (results.length && results.every((r) => r.error)) break; // nichts geht – nicht endlos wiederholen
  }
  return { done, saved, errors };
}

export const runCompaction = (adminToken: string, body: { projectId?: string; dryRun?: boolean }) => invokeCompact(adminToken, body);
