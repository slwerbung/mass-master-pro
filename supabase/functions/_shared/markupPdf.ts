// Spec C: Markierungen fuer das serverseitige Aufmass-PDF (pdf-lib, Ursprung unten links). Reine Funktionen, getestet.
import { markupToDrawOps, numberTopLevel, type DrawOp, type Markup, type MediaRef } from "./markup.ts";

export interface FeedbackRow {
  id: string;
  location_id: string;
  message: string;
  author_name: string | null;
  status: string | null;
  created_at: string;
  parent_id: string | null;
  markup: Markup | null;
  media_ref: MediaRef | null;
}

export interface MarkupItem { markup: Markup; number: number; done: boolean }

/** Markierungen eines Standorts, die zu genau diesem Medium gehoeren (nummeriert wie in der App). */
export function markupItemsFor(rows: FeedbackRow[], match: (ref: MediaRef) => boolean): MarkupItem[] {
  const numbers = numberTopLevel(rows);
  return rows.filter((f) => f.markup && f.media_ref && !f.parent_id && match(f.media_ref))
    .map((f) => ({ markup: f.markup!, number: numbers.get(f.id) ?? 0, done: f.status === "done" }));
}

/**
 * DrawOps in PDF-Koordinaten (Ursprung unten links) fuer ein Medium, das bei (x, y) mit Breite w / Hoehe h gezeichnet wurde.
 * `markupToDrawOps` rechnet mit y nach unten – hier wird gespiegelt.
 */
export function pdfMarkupOps(items: MarkupItem[], box: { x: number; y: number; w: number; h: number }): DrawOp[] {
  const fx = (v: number) => box.x + v;
  const fy = (v: number) => box.y + box.h - v;
  const out: DrawOp[] = [];
  for (const it of items) {
    for (const o of markupToDrawOps(it.markup, { x: 0, y: 0, w: box.w, h: box.h }, { label: String(it.number || ""), done: it.done })) {
      switch (o.op) {
        case "line": out.push({ ...o, x1: fx(o.x1), y1: fy(o.y1), x2: fx(o.x2), y2: fy(o.y2) }); break;
        case "rect": out.push({ ...o, x: fx(o.x), y: fy(o.y + o.h), w: o.w, h: o.h }); break;
        case "ellipse": out.push({ ...o, cx: fx(o.cx), cy: fy(o.cy) }); break;
        case "polyline": out.push({ ...o, pts: o.pts.map(([a, b]) => [fx(a), fy(b)] as [number, number]) }); break;
        case "text": out.push({ ...o, x: fx(o.x), y: fy(o.y) }); break;
        case "badge": out.push({ ...o, x: fx(o.x), y: fy(o.y) }); break;
      }
    }
  }
  return out;
}

export function hexColor(rgb: (r: number, g: number, b: number) => any, hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0xe11d48;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
