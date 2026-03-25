import { Group, Rect, IText } from "fabric";

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

  // All child positions relative to group center (0,0)
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

  // Dynamic font size based on edge length (same logic as line measurement)
  const widthFontSize = Math.max(10, Math.min(22, w * 0.18));
  const heightFontSize = Math.max(10, Math.min(22, h * 0.18));
  const widthPadding = Math.max(2, Math.round(widthFontSize * 0.18));
  const heightPadding = Math.max(2, Math.round(heightFontSize * 0.18));

  // Inset from edge
  const widthInset = Math.max(8, Math.min(20, h * 0.12));
  const heightInset = Math.max(8, Math.min(20, w * 0.12));

  // Width label: centered on top edge, inside, horizontal
  const widthLabel = new IText(`${widthMm} mm`, {
    left: 0,
    top: -cy + widthInset,
    originX: "center",
    originY: "top",
    fill: color,
    fontSize: widthFontSize,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: widthPadding,
    selectable: false,
    editable: false,
  });

  // Height label: centered on left edge, inside, rotated 90° (text runs along edge)
  const heightLabel = new IText(`${heightMm} mm`, {
    left: -cx + heightInset,
    top: 0,
    originX: "center",
    originY: "top",
    angle: 90,
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

  const group = new Group([rect, widthLabel, heightLabel, indexLabel], {
    left: left + cx,
    top: top + cy,
    originX: "center",
    originY: "center",
    selectable: true,
    subTargetCheck: false,
    objectCaching: true,
  });

  // @ts-ignore
  group.data = { type: "area", index, widthMm, heightMm };

  return group;
}
