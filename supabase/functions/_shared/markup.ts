// Markierungen auf Druckdatei/Foto (Spec C). Gemeinsamer Code fuer Edge Functions und App:
// supabase/functions/_shared/markup.ts ist das Original, src/lib/markup.ts eine identische Kopie
// (ein vitest-Test prueft die Gleichheit). Keine Imports – laeuft in Deno und im Browser.
//
// Alle Koordinaten sind normiert 0..1 relativ zur dargestellten Seite bzw. zum Bild (nicht zum Container).

export type Shape =
  | { t: "pin"; x: number; y: number }
  | { t: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "ellipse"; x: number; y: number; w: number; h: number }
  | { t: "path"; pts: [number, number][] }
  | { t: "text"; x: number; y: number; text: string };

export interface Markup { v: 1; color: string; shapes: Shape[] }

export type MediaRef =
  | { kind: "pdf"; storagePath: string; page: number }
  | { kind: "image"; storagePath: string };

export const MARKUP_COLORS = ["#E11D48", "#EAB308", "#2563EB", "#111827"] as const;
export const DEFAULT_MARKUP_COLOR = "#E11D48";
export const MAX_SHAPES = 30;
export const MAX_POINTS = 2000;
export const MAX_MARKUP_BYTES = 30 * 1024;
export const MAX_TEXT = 200;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type MarkupResult = { ok: true; markup: Markup } | { ok: false; error: string };

/** Markierung pruefen und normalisieren (Zahlen auf [0,1] klemmen). Liefert eine deutsche Fehlermeldung. */
export function validateMarkup(raw: unknown): MarkupResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Markierung fehlt." };
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return { ok: false, error: "Unbekanntes Markierungsformat." };
  const color = typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : null;
  if (!color) return { ok: false, error: "Ungültige Farbe." };
  if (!Array.isArray(r.shapes) || r.shapes.length < 1) return { ok: false, error: "Die Markierung ist leer." };
  if (r.shapes.length > MAX_SHAPES) return { ok: false, error: `Höchstens ${MAX_SHAPES} Formen je Markierung.` };
  let points = 0;
  const shapes: Shape[] = [];
  for (const s of r.shapes as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") return { ok: false, error: "Ungültige Form." };
    const n = (k: string) => num(s[k]);
    const bad = () => ({ ok: false as const, error: "Ungültige Koordinaten in der Markierung." });
    // Ausreisser (z. B. 5) sind kein Rundungsfehler mehr, sondern kaputte Daten.
    const inRange = (...xs: (number | null)[]) => xs.every((x) => x !== null && x >= -0.05 && x <= 1.05);
    switch (s.t) {
      case "pin": {
        const x = n("x"), y = n("y");
        if (!inRange(x, y)) return bad();
        shapes.push({ t: "pin", x: clamp01(x!), y: clamp01(y!) });
        points += 1;
        break;
      }
      case "arrow": {
        const x1 = n("x1"), y1 = n("y1"), x2 = n("x2"), y2 = n("y2");
        if (!inRange(x1, y1, x2, y2)) return bad();
        shapes.push({ t: "arrow", x1: clamp01(x1!), y1: clamp01(y1!), x2: clamp01(x2!), y2: clamp01(y2!) });
        points += 2;
        break;
      }
      case "rect":
      case "ellipse": {
        const x = n("x"), y = n("y"), w = n("w"), h = n("h");
        if (!inRange(x, y, w, h) || w! < 0 || h! < 0) return bad();
        const cx = clamp01(x!), cy = clamp01(y!);
        shapes.push({ t: s.t, x: cx, y: cy, w: Math.min(clamp01(w!), 1 - cx), h: Math.min(clamp01(h!), 1 - cy) });
        points += 2;
        break;
      }
      case "path": {
        if (!Array.isArray(s.pts) || s.pts.length < 2) return { ok: false, error: "Freihand-Linie zu kurz." };
        const pts: [number, number][] = [];
        for (const p of s.pts as unknown[]) {
          if (!Array.isArray(p) || p.length !== 2) return bad();
          const px = num(p[0]), py = num(p[1]);
          if (!inRange(px, py)) return bad();
          pts.push([clamp01(px!), clamp01(py!)]);
        }
        points += pts.length;
        shapes.push({ t: "path", pts });
        break;
      }
      case "text": {
        const x = n("x"), y = n("y");
        if (!inRange(x, y)) return bad();
        const text = typeof s.text === "string" ? s.text.trim().slice(0, MAX_TEXT) : "";
        if (!text) return { ok: false, error: "Text-Markierung ohne Text." };
        shapes.push({ t: "text", x: clamp01(x!), y: clamp01(y!), text });
        points += 1;
        break;
      }
      default:
        return { ok: false, error: "Unbekannte Form in der Markierung." };
    }
    if (points > MAX_POINTS) return { ok: false, error: "Die Markierung hat zu viele Punkte." };
  }
  const markup: Markup = { v: 1, color, shapes };
  if (JSON.stringify(markup).length > MAX_MARKUP_BYTES) return { ok: false, error: "Die Markierung ist zu groß." };
  return { ok: true, markup };
}

/** media_ref pruefen: Art, Pfad, Seite (1-basiert). */
export function validateMediaRef(raw: unknown): { ok: true; ref: MediaRef } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Bezug der Markierung fehlt." };
  const r = raw as Record<string, unknown>;
  const storagePath = typeof r.storagePath === "string" ? r.storagePath.trim() : "";
  if (!storagePath || storagePath.length > 500) return { ok: false, error: "Ungültige Datei in der Markierung." };
  if (r.kind === "image") return { ok: true, ref: { kind: "image", storagePath } };
  if (r.kind === "pdf") {
    const page = num(r.page);
    if (page === null || !Number.isInteger(page) || page < 1 || page > 500) return { ok: false, error: "Ungültige Seitenzahl." };
    return { ok: true, ref: { kind: "pdf", storagePath, page } };
  }
  return { ok: false, error: "Unbekannte Dateiart in der Markierung." };
}

/** Freihand vereinfachen (Ramer-Douglas-Peucker), Endpunkte bleiben erhalten. */
export function simplifyPath(pts: [number, number][], epsilon = 0.002): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = dist(pts[i], pts[s], pts[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > epsilon) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Rechteck, in dem ein Medium bei object-contain tatsaechlich erscheint (Letterboxing), relativ zum Container. */
export function containRect(container: { w: number; h: number }, natural: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  if (!container.w || !container.h || !natural.w || !natural.h) return { x: 0, y: 0, w: container.w || 0, h: container.h || 0 };
  const scale = Math.min(container.w / natural.w, container.h / natural.h);
  const w = natural.w * scale, h = natural.h * scale;
  return { x: (container.w - w) / 2, y: (container.h - h) / 2, w, h };
}

/** Ankerpunkt einer Markierung (fuer den Nummern-Badge): erster Punkt der ersten Form. */
export function markupAnchor(m: Markup): { x: number; y: number } {
  const s = m.shapes[0];
  switch (s.t) {
    case "pin": case "text": case "rect": case "ellipse": return { x: s.x, y: s.y };
    case "arrow": return { x: s.x1, y: s.y1 };
    case "path": return { x: s.pts[0][0], y: s.pts[0][1] };
  }
}

export type DrawOp =
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { op: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { op: "ellipse"; cx: number; cy: number; rx: number; ry: number; color: string }
  | { op: "polyline"; pts: [number, number][]; color: string }
  | { op: "text"; x: number; y: number; text: string; color: string }
  | { op: "badge"; x: number; y: number; label: string; color: string; done: boolean };

/**
 * Markierung in absolute Zeichenbefehle fuer ein Zielrechteck umrechnen (Export, Aufmass-PDF). y waechst nach unten;
 * wer nach oben zaehlt (pdf-lib), spiegelt selbst. Pfeilspitzen als zwei kurze Linien, Pin als kleiner Kreis.
 */
export function markupToDrawOps(m: Markup, rect: { x: number; y: number; w: number; h: number }, badge?: { label: string; done: boolean }): DrawOp[] {
  const X = (v: number) => rect.x + v * rect.w;
  const Y = (v: number) => rect.y + v * rect.h;
  const color = m.color;
  const ops: DrawOp[] = [];
  const unit = Math.max(4, Math.min(rect.w, rect.h) * 0.02);
  for (const s of m.shapes) {
    switch (s.t) {
      case "pin":
        ops.push({ op: "ellipse", cx: X(s.x), cy: Y(s.y), rx: unit * 0.6, ry: unit * 0.6, color });
        break;
      case "arrow": {
        const x1 = X(s.x1), y1 = Y(s.y1), x2 = X(s.x2), y2 = Y(s.y2);
        ops.push({ op: "line", x1, y1, x2, y2, color });
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = unit * 1.6;
        for (const d of [Math.PI - 0.45, Math.PI + 0.45]) {
          ops.push({ op: "line", x1: x2, y1: y2, x2: x2 + head * Math.cos(ang + d), y2: y2 + head * Math.sin(ang + d), color });
        }
        break;
      }
      case "rect":
        ops.push({ op: "rect", x: X(s.x), y: Y(s.y), w: s.w * rect.w, h: s.h * rect.h, color });
        break;
      case "ellipse":
        ops.push({ op: "ellipse", cx: X(s.x + s.w / 2), cy: Y(s.y + s.h / 2), rx: (s.w * rect.w) / 2, ry: (s.h * rect.h) / 2, color });
        break;
      case "path":
        ops.push({ op: "polyline", pts: s.pts.map(([px, py]) => [X(px), Y(py)] as [number, number]), color });
        break;
      case "text":
        ops.push({ op: "text", x: X(s.x), y: Y(s.y), text: s.text, color });
        break;
    }
  }
  if (badge) {
    const a = markupAnchor(m);
    ops.push({ op: "badge", x: X(a.x), y: Y(a.y), label: badge.label, color, done: badge.done });
  }
  return ops;
}

/** Nummern der Top-Level-Kommentare (aelteste zuerst = 1). Antworten bekommen keine Nummer. */
export function numberTopLevel<T extends { id: string; parent_id?: string | null; created_at: string }>(items: T[]): Map<string, number> {
  const top = items.filter((i) => !i.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return new Map(top.map((t, i) => [t.id, i + 1]));
}
