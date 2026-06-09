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
 * Instead we load via an object URL (no giant base64 string), read the
 * intrinsic dimensions, and draw straight onto a downscaled canvas. The
 * browser decodes large <img> elements with managed/downsampled memory, and
 * EXIF orientation is applied automatically by drawImage on modern browsers
 * (Chrome 81+, Safari 13.4+, Firefox 77+).
 */

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

export async function readImageFileForEditor(
  file: File,
  maxDimension = 2200,
  quality = 0.92
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    const natW = img.naturalWidth || img.width || 1;
    const natH = img.naturalHeight || img.height || 1;
    const scale = Math.min(1, maxDimension / Math.max(natW, natH));
    const width = Math.max(1, Math.round(natW * scale));
    const height = Math.max(1, Math.round(natH * scale));
    return drawToJpegDataUrl(img, width, height, quality);
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
