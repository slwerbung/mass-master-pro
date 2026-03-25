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
  const areaSqM = (widthMm * heightMm) / 1_000_000;

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

  const fontSize = Math.max(10, Math.min(18, Math.min(w, h) * 0.15));
  const padding = Math.max(2, Math.round(fontSize * 0.2));

  // Width label on top
  const widthLabel = new IText(`${widthMm} mm`, {
    left: 0, top: -cy - fontSize - 6,
    originX: "center", originY: "top",
    fill: color, fontSize, fontFamily: "Arial", fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)", padding,
    selectable: false, editable: false,
  });

  // Height label on left
  const heightLabel = new IText(`${heightMm} mm`, {
    left: -cx - 6, top: 0,
    originX: "right", originY: "center",
    fill: color, fontSize, fontFamily: "Arial", fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)", padding,
    selectable: false, editable: false,
  });

  // Area label in center
  const areaLabel = new IText(`${areaSqM.toFixed(2)} m²`, {
    left: 0, top: 0,
    originX: "center", originY: "center",
    fill: color, fontSize: fontSize * 1.1, fontFamily: "Arial", fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.9)", padding,
    selectable: false, editable: false,
  });

  // Index label top-left
  const indexLabel = new IText(`F ${index}`, {
    left: -cx + 4, top: -cy + 4,
    originX: "left", originY: "top",
    fill: "#ffffff", fontSize: fontSize * 0.9, fontFamily: "Arial", fontWeight: "bold",
    backgroundColor: color, padding: 3,
    selectable: false, editable: false,
  });

  const group = new Group([rect, widthLabel, heightLabel, areaLabel, indexLabel], {
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
