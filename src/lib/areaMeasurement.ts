import { Group, Rect, IText, Line } from "fabric";

function createParallelLabel(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  color: string,
  side: "above" | "left",
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  const px = -dy / len;
  const py = dx / len;

  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;

  const fontSize = Math.max(10, Math.min(22, len * 0.18));
  const distance = Math.max(8, Math.min(18, len * 0.10));
  const padding = Math.max(2, Math.round(fontSize * 0.18));

  // For horizontal width guide, move label upward.
  // For vertical height guide, move label left.
  let offsetSign = 1;
  if (side === "above") {
    offsetSign = py < 0 ? 1 : -1;
  } else if (side === "left") {
    offsetSign = px < 0 ? 1 : -1;
  }

  let labelAngle = angle;
  // Ensure vertical label reads bottom-to-top, i.e. "nach oben laufend".
  if (side === "left") {
    labelAngle = 90;
  }

  const labelObj = new IText(label, {
    left: centerX + px * distance * offsetSign,
    top: centerY + py * distance * offsetSign,
    originX: "center",
    originY: "center",
    angle: labelAngle,
    fill: color,
    fontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding,
    selectable: false,
    editable: false,
  });

  return labelObj;
}

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
    left: -cx,
    top: -cy,
    width: w,
    height: h,
    fill: `${color}20`,
    stroke: color,
    strokeWidth: 2,
    strokeDashArray: [8, 4],
    selectable: false,
  });

  const topGuideInset = Math.max(12, Math.min(26, h * 0.16));
  const leftGuideInset = Math.max(12, Math.min(26, w * 0.16));
  const guideEndPadding = Math.max(10, Math.min(20, Math.min(w, h) * 0.10));
  const topGuideY = -cy + topGuideInset;
  const leftGuideX = -cx + leftGuideInset;

  const widthLineStartX = -cx + guideEndPadding;
  const widthLineEndX = cx - guideEndPadding;
  const widthLineY = topGuideY;

  const heightLineX = leftGuideX;
  const heightLineStartY = -cy + guideEndPadding;
  const heightLineEndY = cy - guideEndPadding;

  const topGuide = new Line([
    widthLineStartX,
    widthLineY,
    widthLineEndX,
    widthLineY,
  ], {
    stroke: color,
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    opacity: 0.85,
    selectable: false,
  });

  const leftGuide = new Line([
    heightLineX,
    heightLineStartY,
    heightLineX,
    heightLineEndY,
  ], {
    stroke: color,
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    opacity: 0.85,
    selectable: false,
  });

  const widthLabel = createParallelLabel(
    widthLineStartX,
    widthLineY,
    widthLineEndX,
    widthLineY,
    `${widthMm} mm`,
    color,
    "above",
  );

  const heightLabel = createParallelLabel(
    heightLineX,
    heightLineStartY,
    heightLineX,
    heightLineEndY,
    `${heightMm} mm`,
    color,
    "left",
  );

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
