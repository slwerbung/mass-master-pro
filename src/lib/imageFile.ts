/**
 * Load an image File and return a downscaled JPEG data URL for the editor.
 *
 * Memory-critical: high-megapixel phone cameras (12–50 MP) must NEVER be
 * decoded at full resolution. The previous version called
 *   createImageBitmap(file, { imageOrientation: "from-image" })
 * with no resize, which allocates the full RGBA buffer (e.g. a 48 MP photo =
 * ~190 MB) and crashes mobile browsers with an out-of-memory error the moment
 * the user confirms the shot in the native camera app.
 *
 * Instead we read the intrinsic dimensions via an object URL (no giant
 * base64 string) and let createImageBitmap decode straight to the target
 * size (see decodeScaled). EXIF orientation is applied ("from-image").
 */

import { cameraStage } from "./cameraGuard";

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
    img.src = src;
  });
}

function drawToJpegDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas-Kontext nicht verfügbar");
  ctx.drawImage(source, 0, 0, width, height);
  const url = canvas.toDataURL("image/jpeg", quality);
  // Release the canvas backing store promptly to help GC on mobile.
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

// Reads only the (orientation-corrected) dimensions. The <img> is never
// drawn, so the photo is not decoded here; src is dropped right after.
async function readDimensions(objectUrl: string): Promise<{ w: number; h: number }> {
  const img = await loadHtmlImage(objectUrl);
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  img.src = "";
  return { w, h };
}

// Decode straight to the target size. Measured (Sept. 2026): drawing the
// <img> of a 12 MP photo kept ~48 MB per photo in the page that the browser
// did not give back – on a 50 MP camera ~200 MB. Photo 1 worked, and for
// photo 2 Android ended the app while the camera was open. createImageBitmap
// with a resize target never keeps the full-size pixels around.
async function decodeScaled(file: File, width: number, height: number): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  const attempt = (w: number, h: number) =>
    createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high", imageOrientation: "from-image" });
  try {
    let bmp = await attempt(width, height);
    if (bmp.width === width && bmp.height === height) return bmp;
    // Some engines resize BEFORE applying the EXIF rotation → sides swapped.
    bmp.close();
    bmp = await attempt(height, width);
    if (bmp.width === width && bmp.height === height) return bmp;
    bmp.close();
    return null;
  } catch {
    return null;
  }
}

export async function readImageFileForEditor(
  file: File,
  maxDimension = 2200,
  quality = 0.92
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const { w: natW, h: natH } = await readDimensions(objectUrl);
    // Diagnostics: a crash between "dims" and "scaled" means decoding the
    // photo ran out of memory (see cameraGuard.ts).
    cameraStage("dims", { photoW: natW, photoH: natH, megapixels: Math.round((natW * natH) / 1e5) / 10 });
    const scale = Math.min(1, maxDimension / Math.max(natW, natH));
    const width = Math.max(1, Math.round(natW * scale));
    const height = Math.max(1, Math.round(natH * scale));
    let url: string;
    const bmp = await decodeScaled(file, width, height);
    if (bmp) {
      try { url = drawToJpegDataUrl(bmp, width, height, quality); } finally { bmp.close(); }
    } else {
      // Fallback (old browsers): via <img>, dropped again right after.
      const img = await loadHtmlImage(objectUrl);
      try { url = drawToJpegDataUrl(img, width, height, quality); } finally { img.src = ""; }
    }
    cameraStage("scaled", { scaledW: width, scaledH: height, scaledBytes: url.length, decoder: bmp ? "bitmap" : "img" });
    return url;
  } catch {
    // Last resort for small images: return the file bytes as a data URL.
    // (No downscaling here, so only reached if the canvas path failed.)
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Fehler beim Laden des Bildes"));
      reader.readAsDataURL(file);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
