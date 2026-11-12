// Spec D2: Unterschiede zweier Seiten im Hintergrund rechnen (OffscreenCanvas), damit die Oberfläche nicht hängt.
import { countChanged, dilate, diffMask, maskToOverlay } from "./diff";

interface Req { id: number; a: ImageBitmap; b: ImageBitmap; w: number; h: number; threshold?: number }

function pixels(bmp: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, a, b, w, h, threshold = 40 } = e.data;
  try {
    const mask = dilate(diffMask(pixels(a, w, h), pixels(b, w, h), w, h, threshold), w, h, 2);
    const overlay = maskToOverlay(mask);
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d")!.putImageData(new ImageData(overlay as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    (self as any).postMessage({ id, ok: true, blob, changed: countChanged(mask) });
  } catch (err) {
    (self as any).postMessage({ id, ok: false, error: String((err as Error)?.message || err) });
  } finally {
    a.close?.(); b.close?.();
  }
};
