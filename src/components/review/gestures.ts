// Zoom/Verschieben als reine Zustandsfunktionen (Spec C, getestet in gestures.test.ts). Die Darstellung ist
// transform: translate(tx,ty) scale(s) mit Ursprung oben links; Markierungen bleiben normiert.

export interface View { scale: number; tx: number; ty: number }
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const IDENTITY: View = { scale: 1, tx: 0, ty: 0 };

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom um einen Bildschirmpunkt (px relativ zur Bühne): der Punkt unter dem Finger bleibt stehen. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, tx: v.tx + dx, ty: v.ty + dy };
}

/** Bühne nicht aus dem Bild schieben: bei scale 1 zurück auf 0, sonst innerhalb der vergrößerten Fläche. */
export function clampView(v: View, w: number, h: number): View {
  if (v.scale <= 1) return IDENTITY;
  const minX = w - w * v.scale, minY = h - h * v.scale;
  return { scale: v.scale, tx: Math.min(0, Math.max(minX, v.tx)), ty: Math.min(0, Math.max(minY, v.ty)) };
}

type P = { x: number; y: number };

/** Zwei-Finger-Geste: Startzustand + Startpunkte → neuer Zustand (Zoom um den Mittelpunkt, Verschieben mit ihm). */
export function pinch(start: View, a0: P, b0: P, a1: P, b1: P): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const zoomed = zoomAt(start, d1 / d0, m0.x, m0.y);
  return panBy(zoomed, m1.x - m0.x, m1.y - m0.y);
}

/** Doppeltipp: 1× ↔ 2× um den Tipp-Punkt. */
export function doubleTap(v: View, px: number, py: number): View {
  return v.scale > 1.05 ? IDENTITY : zoomAt(IDENTITY, 2, px, py);
}

/** Kam der zweite Finger so schnell, dass der angefangene Strich ein Versehen war? */
export const STROKE_GRACE_MS = 150;
export const discardStroke = (strokeStartedAt: number | null, now: number) => strokeStartedAt !== null && now - strokeStartedAt < STROKE_GRACE_MS;
