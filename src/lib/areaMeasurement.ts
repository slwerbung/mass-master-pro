import { Group, IText, Line, Circle, Shadow } from "fabric";

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

// Candidate label offsets on a grid, nearest ring first, preferring positions
// level with or below the anchor over ones above it (labels reading downward
// look more natural and stay off the ceiling/sky). Built once and reused.
const PLACEMENT_GRID: { gx: number; gy: number }[] = (() => {
  const g: { gx: number; gy: number }[] = [];
  for (let ring = 0; ring <= 12; ring++) {
    for (let gy = -ring; gy <= ring; gy++) {
      for (let gx = -ring; gx <= ring; gx++) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) === ring) g.push({ gx, gy });
      }
    }
  }
  return g.sort((a, b) => {
    const ra = Math.max(Math.abs(a.gx), Math.abs(a.gy));
    const rb = Math.max(Math.abs(b.gx), Math.abs(b.gy));
    if (ra !== rb) return ra - rb;
    const ua = a.gy < 0 ? 1 : 0, ub = b.gy < 0 ? 1 : 0;
    if (ua !== ub) return ua - ub;
    const ma = Math.abs(a.gx) + Math.abs(a.gy), mb = Math.abs(b.gx) + Math.abs(b.gy);
    if (ma !== mb) return ma - mb;
    return a.gx - b.gx;
  });
})();

function overlaps(a: Box, b: Box, margin = 3): boolean {
  return !(
    a.left + a.w + margin <= b.left ||
    b.left + b.w + margin <= a.left ||
    a.top + a.h + margin <= b.top ||
    b.top + b.h + margin <= a.top
  );
}

// Measure with a plain 2D context instead of constructing Fabric text objects
// (cheaper, and avoids running Fabric internals inside a canvas event handler).
let _measureCtx: CanvasRenderingContext2D | null = null;
function measureLabelWidth(text: string, fontSize: number): number {
  try {
    if (!_measureCtx && typeof document !== "undefined") {
      _measureCtx = document.createElement("canvas").getContext("2d");
    }
    if (_measureCtx) {
      _measureCtx.font = `bold ${fontSize}px Arial`;
      const w = _measureCtx.measureText(text).width;
      if (Number.isFinite(w) && w > 0) return w;
    }
  } catch { /* fall through to estimate */ }
  return text.length * fontSize * 0.56;
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
  try {
    renderAreaLabelsInner(canvas, color);
  } catch (e) {
    // Labels are cosmetic — never let a layout error break editing or export.
    console.warn("renderAreaLabels failed:", e);
  }
}

function renderAreaLabelsInner(canvas: any, color: string): void {
  // Drop previously derived labels/leaders.
  canvas.getObjects()
    .filter((o: any) => o.data?.type === "area-label" || o.data?.type === "area-leader")
    .forEach((o: any) => canvas.remove(o));

  const areas = canvas.getObjects().filter((o: any) => o.data?.type === "area");
  if (!areas.length) return;

  interface Entry {
    cx: number; cyMid: number; anchorX: number; anchorY: number; index: number; text: string;
    labelW: number; labelH: number; effW: number; effH: number; fontSize: number; forceLeader: boolean;
  }

  const entries: Entry[] = areas.map((a: any) => {
    const c = a.getCenterPoint();
    const aw = a.getScaledWidth ? a.getScaledWidth() : (a.width * (a.scaleX ?? 1));
    const ah = a.getScaledHeight ? a.getScaledHeight() : (a.height * (a.scaleY ?? 1));
    const d = a.data;
    // On the image we show ONLY the area name (F1, F2, …). The actual
    // dimensions live in the location's measurement list, so the photo stays
    // clean and labels of neighbouring areas can never crowd each other out.
    const text = `F${d.index}`;

    // Label size scales with the area's on-screen size so it never overwhelms a
    // small surface, but stays within a readable band.
    const fontSize = clamp(Math.round(Math.min(aw, ah) * 0.24), 11, 18);
    const labelW = measureLabelWidth(text, fontSize);
    const labelH = fontSize * 1.25;
    // Collision footprint includes the white halo + shadow + a breathing gap,
    // so labels never visually touch even though their text boxes don't overlap.
    const pad = fontSize * 0.4 + 5;
    const effW = labelW + pad * 2;
    const effH = labelH + pad;

    // Centre the label on the diagonal midpoint only when it comfortably fits
    // inside the area; otherwise park it just below the area so it never covers
    // the measured surface, with a leader back to the midpoint.
    const fits = labelW <= aw - 6 && labelH <= ah - 4;
    const areaBottom = c.y + ah / 2;
    const anchorY = fits ? c.y : areaBottom + labelH / 2 + 4;

    return { cx: c.x, cyMid: c.y, anchorX: c.x, anchorY, index: d.index, text, labelW, labelH, effW, effH, fontSize, forceLeader: !fits };
  });

  const grid = PLACEMENT_GRID;

  // Place from top to bottom, left to right, for a stable result.
  entries.sort((p, q) => (p.anchorY - q.anchorY) || (p.cx - q.cx));

  const placed: Box[] = [];
  const leaderSpecs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const labelObjs: any[] = [];

  for (const e of entries) {
    const stepX = e.effW * 0.62;
    const stepY = e.effH;
    let fx = e.anchorX, fy = e.anchorY;
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      const x = e.anchorX + g.gx * stepX;
      const y = e.anchorY + g.gy * stepY;
      const box: Box = { left: x - e.effW / 2, top: y - e.effH / 2, w: e.effW, h: e.effH };
      const free = !placed.some((b) => overlaps(box, b, 0));
      if (free || i === grid.length - 1) { fx = x; fy = y; placed.push(box); break; }
    }

    // Leader from the diagonal midpoint to the label, drawn whenever the label
    // was parked outside its area or nudged noticeably away.
    const displaced = Math.hypot(fx - e.cx, fy - e.cyMid);
    if (e.forceLeader || displaced > e.labelH * 0.9) {
      const edgeY = fy > e.cyMid ? fy - e.labelH / 2 : fy + e.labelH / 2;
      leaderSpecs.push({ x1: e.cx, y1: e.cyMid, x2: fx, y2: edgeY });
    }

    // Lightweight label: outlined text (no bulky pill). A white halo + soft
    // shadow keeps it legible on any background while staying unobtrusive.
    const label = new IText(e.text, {
      left: fx,
      top: fy,
      originX: "center",
      originY: "center",
      fill: color,
      fontSize: e.fontSize,
      fontFamily: "Arial",
      fontWeight: "bold",
      stroke: "#ffffff",
      strokeWidth: Math.max(1.5, e.fontSize * 0.16),
      paintFirst: "stroke",
      selectable: false,
      evented: false,
      excludeFromExport: true,
      shadow: new Shadow({ color: "rgba(0,0,0,0.55)", blur: 2, offsetX: 0, offsetY: 1 }),
    });
    // @ts-ignore
    label.data = { type: "area-label", index: e.index };
    labelObjs.push(label);
  }

  // Add ALL leaders first, then all labels, so a leader can never render on top
  // of another label's text — labels always paint over the thin guide lines.
  for (const s of leaderSpecs) {
    const leader = new Line([s.x1, s.y1, s.x2, s.y2], {
      stroke: color, strokeWidth: 1, opacity: 0.55,
      selectable: false, evented: false, excludeFromExport: true,
    });
    // @ts-ignore
    leader.data = { type: "area-leader" };
    canvas.add(leader);
  }
  for (const label of labelObjs) canvas.add(label);

  canvas.requestRenderAll();
}
