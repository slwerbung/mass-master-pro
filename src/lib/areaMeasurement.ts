import { Group, Rect, IText, Line } from "fabric";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function estimateFontSizeForSpan(label: string, primarySpan: number, secondarySpan: number) {
  const bySecondary = secondarySpan - 6;
  const byPrimary = primarySpan / Math.max(label.length * 0.62, 1);
  return clamp(Math.min(bySecondary, byPrimary), 10, 20);
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

  const widthLabelText = `${widthMm} mm`;
  const heightLabelText = `${heightMm} mm`;

  // Keep every visual element inside the rectangle so the group bounding box
  // matches the user's actual clicked area exactly without positional offsets.
  const topBand = clamp(Math.min(h * 0.22, 28), 18, Math.max(18, h - 8));
  const leftBand = clamp(Math.min(w * 0.22, 28), 18, Math.max(18, w - 8));

  const widthFontSize = estimateFontSizeForSpan(widthLabelText, w - 10, topBand);
  const heightFontSize = estimateFontSizeForSpan(heightLabelText, h - 10, leftBand);

  const rect = new Rect({
    left: 0,
    top: 0,
    width: w,
    height: h,
    originX: "left",
    originY: "top",
    fill: `${color}20`,
    stroke: color,
    strokeWidth: 2,
    strokeDashArray: [8, 4],
    selectable: false,
  });

  // Two inner guide lines that stay fully INSIDE the measured area.
  // Width label sits above the horizontal guide, height label sits left of the vertical guide.
  const topGuide = new Line([0, topBand, w, topBand], {
    stroke: color,
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    opacity: 0.85,
    selectable: false,
  });

  const leftGuide = new Line([leftBand, 0, leftBand, h], {
    stroke: color,
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    opacity: 0.85,
    selectable: false,
  });

  const widthLabel = new IText(widthLabelText, {
    left: w / 2,
    top: Math.max(8, topBand / 2),
    originX: "center",
    originY: "center",
    angle: 0,
    fill: color,
    fontSize: widthFontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: 2,
    selectable: false,
    editable: false,
  });

  const heightLabel = new IText(heightLabelText, {
    left: Math.max(8, leftBand / 2),
    top: h / 2,
    originX: "center",
    originY: "center",
    angle: 90,
    fill: color,
    fontSize: heightFontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: 2,
    selectable: false,
    editable: false,
  });

  const idxFontSize = clamp(Math.min(w, h) * 0.12, 10, 16);
  const indexLabel = new IText(`F ${index}`, {
    left: 4,
    top: 4,
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
    left,
    top,
    originX: "left",
    originY: "top",
    selectable: true,
    subTargetCheck: false,
    objectCaching: true,
  });

  group.setCoords();

  // @ts-ignore
  group.data = { type: "area", index, widthMm, heightMm };

  return group;
}
