// Spec D2: Pixel-Vergleich zweier Versionen (reine Funktionen, getestet). Läuft im Web Worker (diff.worker.ts).

/** Zielgröße: längere Seite `longest` px, Seitenverhältnis der neuen Version. */
export function fitSize(w: number, h: number, longest = 1600): { w: number; h: number } {
  if (!w || !h) return { w: 0, h: 0 };
  const k = longest / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Weichen die Seitenverhältnisse um mehr als `tol` (relativ) ab? → Hinweis „Format geändert“. */
export function aspectDiffers(a: { w: number; h: number }, b: { w: number; h: number }, tol = 0.02): boolean {
  if (!a.w || !a.h || !b.w || !b.h) return false;
  const ra = a.w / a.h, rb = b.w / b.h;
  return Math.abs(ra - rb) / Math.max(ra, rb) > tol;
}

/** 1 = Pixel geändert (euklidischer RGB-Abstand > threshold), 0 = gleich. Alpha zählt nicht. */
export function diffMask(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, threshold = 40): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n);
  const t2 = threshold * threshold;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const dr = a[p] - b[p], dg = a[p + 1] - b[p + 1], db = a[p + 2] - b[p + 2];
    if (dr * dr + dg * dg + db * db > t2) out[i] = 1;
  }
  return out;
}

/** Quadratische Dilatation um r Pixel (zwei Durchläufe: waagrecht, dann senkrecht) – feine Linien werden sichtbar. */
export function dilate(mask: Uint8Array, w: number, h: number, r = 2): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -Infinity;
    // vorwärts: Abstand zum letzten gesetzten Pixel links
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) last = x;
      if (x - last <= r) tmp[row + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[row + x]) last = x;
      if (last - x <= r) tmp[row + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Maske → halbtransparente rote RGBA-Fläche (nur geänderte Pixel). */
export function maskToOverlay(mask: Uint8Array, rgba: [number, number, number, number] = [225, 29, 72, 150]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    out[p] = rgba[0]; out[p + 1] = rgba[1]; out[p + 2] = rgba[2]; out[p + 3] = rgba[3];
  }
  return out;
}

export const countChanged = (mask: Uint8Array) => { let n = 0; for (let i = 0; i < mask.length; i++) n += mask[i]; return n; };

/** Kann dieser Browser den Unterschiede-Modus (Worker + OffscreenCanvas + createImageBitmap)? */
export const canDiff = () =>
  typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
