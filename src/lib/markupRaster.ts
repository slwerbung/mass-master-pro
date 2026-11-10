// Markierungen in ein Bild einbrennen (Export, Spec C): gleiche Umrechnung wie überall (markupToDrawOps),
// gezeichnet auf ein Canvas in Originalgröße des Bildes. Ergebnis: JPEG-Data-URL.
import { markupToDrawOps, type DrawOp, type Markup } from "@/lib/markup";

export interface RasterItem { markup: Markup; number: number; done: boolean }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp, unit: number) {
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = unit * 0.35;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (op.op) {
    case "line": ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke(); break;
    case "rect": ctx.strokeRect(op.x, op.y, op.w, op.h); break;
    case "ellipse": ctx.beginPath(); ctx.ellipse(op.cx, op.cy, Math.max(1, op.rx), Math.max(1, op.ry), 0, 0, Math.PI * 2); ctx.stroke(); break;
    case "polyline":
      ctx.beginPath();
      op.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      break;
    case "text":
      ctx.font = `600 ${Math.round(unit * 1.6)}px sans-serif`;
      ctx.lineWidth = unit * 0.4;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeText(op.text, op.x, op.y);
      ctx.fillText(op.text, op.x, op.y);
      break;
    case "badge": {
      const r = unit * 1.3;
      ctx.beginPath();
      ctx.arc(op.x, op.y, r, 0, Math.PI * 2);
      ctx.fillStyle = op.done ? "#16a34a" : op.color;
      ctx.fill();
      ctx.lineWidth = unit * 0.25;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(op.done ? "✓" : op.label, op.x, op.y + r * 0.05);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      break;
    }
  }
}

/** Bild + Markierungen → neues Bild. Ohne Markierungen kommt das Original zurück. */
export async function burnMarkup(src: string, items: RasterItem[]): Promise<string> {
  if (!items.length) return src;
  const img = await loadImage(src);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return src;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  const unit = Math.max(4, Math.min(w, h) * 0.012);
  for (const it of items) {
    // Erledigte grau, damit offene ins Auge fallen.
    const markup = it.done ? { ...it.markup, color: "#9ca3af" } : it.markup;
    for (const op of markupToDrawOps(markup, { x: 0, y: 0, w, h }, { label: String(it.number), done: it.done })) drawOp(ctx, op, unit);
  }
  return canvas.toDataURL("image/jpeg", 0.9);
}
