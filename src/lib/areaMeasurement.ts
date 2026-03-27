import { Group, Rect, IText, Line } from "fabric";

export function createAreaMeasurementGroup(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  widthMm: number,
  heightMm: number,
  index: number,
  color: string = "#3b82f6",
) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);

  const cx = w / 2;
  const cy = h / 2;

  const rect = new Rect({
    left: -cx, top: -cy, width: w, height: h,
    fill: `${color}20`,
    stroke: color,
    strokeWidth: 2,
    strokeDashArray: [8, 4],
    selectable: false,
  });

  // Inner dashed guide lines so the labels run parallel INSIDE the drawn area
  const topGuideInset = Math.max(12, Math.min(26, h * 0.16));
  const leftGuideInset = Math.max(12, Math.min(26, w * 0.16));
  const guideEndPadding = Math.max(10, Math.min(20, Math.min(w, h) * 0.10));
  const topGuideY = -cy + topGuideInset;
  const leftGuideX = -cx + leftGuideInset;

  const topGuide = new Line([
    -cx + guideEndPadding,
    topGuideY,
    cx - guideEndPadding,
    topGuideY,
  ], {
    stroke: color,
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    opacity: 0.85,
    selectable: false,
  });

  const leftGuide = new Line([
    leftGuideX,
    -cy + guideEndPadding,
    leftGuideX,
    cy - guideEndPadding,
  ], {
    stroke: color,
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    opacity: 0.85,
    selectable: false,
  });

  // --- Width label (horizontal, above the inner horizontal guide, inside) ---
  const widthText = `${widthMm} mm`;
  const widthCharCount = widthText.length;
  let widthFontSize = Math.max(10, Math.min(22, w * 0.18));
  const maxWidthTextPx = w * 0.78;
  const estimatedWidthPx = widthFontSize * 0.6 * widthCharCount;
  if (estimatedWidthPx > maxWidthTextPx) {
    widthFontSize = Math.max(8, maxWidthTextPx / (0.6 * widthCharCount));
  }
  const widthPadding = Math.max(2, Math.round(widthFontSize * 0.18));
  const widthLabelY = (-cy + topGuideY) / 2;

  const widthLabel = new IText(widthText, {
    left: 0,
    top: widthLabelY,
    originX: "center",
    originY: "center",
    angle: 0,
    fill: color,
    fontSize: widthFontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: widthPadding,
    selectable: false,
    editable: false,
  });

  // --- Height label (vertical, left of the inner vertical guide, inside) ---
  const heightText = `${heightMm} mm`;
  const heightCharCount = heightText.length;
  let heightFontSize = Math.max(10, Math.min(22, h * 0.18));
  const maxHeightTextPx = h * 0.78;
  const estimatedHeightPx = heightFontSize * 0.6 * heightCharCount;
  if (estimatedHeightPx > maxHeightTextPx) {
    heightFontSize = Math.max(8, maxHeightTextPx / (0.6 * heightCharCount));
  }
  const heightPadding = Math.max(2, Math.round(heightFontSize * 0.18));
  const heightLabelX = (-cx + leftGuideX) / 2;

  const heightLabel = new IText(heightText, {
    left: heightLabelX,
    top: 0,
    originX: "center",
    originY: "center",
    angle: -90,
    fill: color,
    fontSize: heightFontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: heightPadding,
    selectable: false,
    editable: false,
  });

  // Index label top-left inside
  const idxFontSize = Math.max(10, Math.min(16, Math.min(w, h) * 0.12));
  const indexLabel = new IText(`F ${index}`, {
    left: -cx + 4,
    top: -cy + 4,
    originX: "left",
    originY: "top",
    fill: "#ffffff",
    fontSize: idxFontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: color,
    padding: 3,
    selectable: false,
    editable: false,
  });

  // Create group WITHOUT left/top, set position after to avoid Fabric v7 offset bug
  const group = new Group([rect, topGuide, leftGuide, widthLabel, heightLabel, indexLabel], {
    originX: "center",
    originY: "center",
    selectable: true,
    subTargetCheck: false,
    objectCaching: true,
  });

  group.set({ left: left + cx, top: top + cy });
  group.setCoords();

  // @ts-ignore
  group.data = { type: "area", index, widthMm, heightMm };

  return group;
}
