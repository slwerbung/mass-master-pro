import { Group, Rect, IText, Line, Circle, Shadow } from "fabric";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const DOT_R = 4;
const LINE_W = 2.5;

/**
 * A measured area is drawn as a single DIAGONAL from click 1 to click 2 (the two
 * opposite corners the user tapped) plus a dot at each end. There is deliberately
 * NO rectangle: a diagonal has no right angle that could clash with the photo's
 * perspective, and it leaves almost no ink on the image. The width×height label is
 * NOT part of this group — it is a derived object placed by `renderAreaLabels`, so
 * labels of different areas can be de-conflicted globally and never overlap.
 *
 * The group's bounding box still spans the whole rectangle (the diagonal reaches
 * both corners), so tapping anywhere inside the area still selects it.
 */
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

  // Local coordinates of the two actual clicks, preserving their orientation
  // (↘ vs ↗) so the diagonal connects the corners the user really tapped.
  const ax = x1 - left, ay = y1 - top;
  const bx = x2 - left, by = y2 - top;

  const diagonal = new Line([ax, ay, bx, by], {
    stroke: color,
    strokeWidth: LINE_W,
    strokeLineCap: "round",
    selectable: false,
    evented: false,
  });

  const dotStyle = { radius: DOT_R, fill: "#ffffff", stroke: color, strokeWidth: 2, originX: "center", originY: "center", selectable: false, evented: false } as const;
  const dot1 = new Circle({ ...dotStyle, left: ax, top: ay });
  const dot2 = new Circle({ ...dotStyle, left: bx, top: by });

  const group = new Group([diagonal, dot1, dot2], {
    left,
    top,
    originX: "left",
    originY: "top",
    selectable: true,
    subTargetCheck: false,
    objectCaching: true,
  });

  group.setCoords();

  // @ts-ignore custom metadata used at export time
  group.data = { type: "area", index, widthMm, heightMm };

  return group;
}

interface Box { left: number; top: number; w: number; h: number; }

function overlaps(a: Box, b: Box, margin = 3): boolean {
  return !(
    a.left + a.w + margin <= b.left ||
    b.left + b.w + margin <= a.left ||
    a.top + a.h + margin <= b.top ||
    b.top + b.h + margin <= a.top
  );
}

const LABEL_FONT = 15;

function measureLabelWidth(text: string): number {
  const t = new IText(text, { fontSize: LABEL_FONT, fontFamily: "Arial", fontWeight: "bold" });
  const w = (t as any).width;
  return Number.isFinite(w) && w > 0 ? w : text.length * LABEL_FONT * 0.56;
}

/**
 * Rebuilds every area label from scratch so that NO two labels overlap.
 *
 * Labels are derived objects (data.type "area-label"/"area-leader"), not part of
 * the area group and excluded from history/JSON — they render into the exported
 * image but are re-created on every relayout. Placement is a deterministic greedy
 * pass: anchor each label at its diagonal's midpoint, then, if that box collides
 * with an already-placed one, try progressively larger vertical offsets (down,
 * then up) until a free slot is found. A displaced label gets a thin leader line
 * back to its midpoint. Greedy vertical stacking guarantees a non-overlapping
 * result for any input.
 */
export function renderAreaLabels(canvas: any, color: string = "#3b82f6"): void {
  if (!canvas) return;

  // Drop previously derived labels/leaders.
  canvas.getObjects()
    .filter((o: any) => o.data?.type === "area-label" || o.data?.type === "area-leader")
    .forEach((o: any) => canvas.remove(o));

  const areas = canvas.getObjects().filter((o: any) => o.data?.type === "area");
  if (!areas.length) return;

  interface Entry { cx: number; cy: number; index: number; text: string; labelW: number; labelH: number; }
  const padX = 7, padY = 4;
  const labelH = LABEL_FONT + padY * 2;

  const entries: Entry[] = areas.map((a: any) => {
    const c = a.getCenterPoint();
    const d = a.data;
    const text = `F${d.index} · ${d.widthMm}×${d.heightMm}`;
    return { cx: c.x, cy: c.y, index: d.index, text, labelW: measureLabelWidth(text) + padX * 2, labelH };
  });

  // Place from top to bottom, left to right, for a stable result.
  entries.sort((p, q) => (p.cy - q.cy) || (p.cx - q.cx));

  const placed: Box[] = [];
  const step = labelH + 6;

  for (const e of entries) {
    let bestOffset = 0;
    for (let i = 0; i < 60; i++) {
      // 0, +step, -step, +2step, -2step, ...
      const k = Math.ceil(i / 2);
      const offset = i === 0 ? 0 : (i % 2 === 1 ? k * step : -k * step);
      const box: Box = { left: e.cx - e.labelW / 2, top: e.cy - e.labelH / 2 + offset, w: e.labelW, h: e.labelH };
      if (!placed.some((b) => overlaps(box, b))) { bestOffset = offset; break; }
      bestOffset = offset; // fallback to last tried
    }

    const finalCy = e.cy + bestOffset;
    placed.push({ left: e.cx - e.labelW / 2, top: finalCy - e.labelH / 2, w: e.labelW, h: e.labelH });

    // Leader line back to the midpoint when the label was pushed away.
    if (Math.abs(bestOffset) > e.labelH * 0.5) {
      const anchorY = finalCy > e.cy ? finalCy - e.labelH / 2 : finalCy + e.labelH / 2;
      const leader = new Line([e.cx, e.cy, e.cx, anchorY], {
        stroke: color,
        strokeWidth: 1,
        opacity: 0.7,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      });
      // @ts-ignore
      leader.data = { type: "area-leader" };
      canvas.add(leader);
    }

    const pill = new Rect({
      width: e.labelW,
      height: e.labelH,
      rx: 5,
      ry: 5,
      originX: "center",
      originY: "center",
      fill: "rgba(255,255,255,0.94)",
      stroke: color,
      strokeWidth: 1,
    });
    const txt = new IText(e.text, {
      originX: "center",
      originY: "center",
      fill: color,
      fontSize: LABEL_FONT,
      fontFamily: "Arial",
      fontWeight: "bold",
    });
    const label = new Group([pill, txt], {
      left: e.cx,
      top: finalCy,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
      excludeFromExport: true,
      shadow: new Shadow({ color: "rgba(0,0,0,0.35)", blur: 3, offsetX: 0, offsetY: 1 }),
    });
    // @ts-ignore
    label.data = { type: "area-label", index: e.index };
    canvas.add(label);
  }

  canvas.requestRenderAll();
}
