import type { Markup, Shape } from "@/lib/markup";
import { markupAnchor } from "@/lib/markup";

export interface LayerItem { id: string; number: number; markup: Markup; done: boolean }

/** Eine Form in Pixeln (Rechteck w×h der dargestellten Seite). Strich bleibt bei Zoom gleich dick. */
export function ShapeSvg({ s, color, w, h, faded }: { s: Shape; color: string; w: number; h: number; faded?: boolean }) {
  const common = { stroke: color, strokeWidth: 3, fill: "none", vectorEffect: "non-scaling-stroke" as const, opacity: faded ? 0.35 : 1 };
  switch (s.t) {
    case "pin":
      return (
        <g opacity={faded ? 0.35 : 1}>
          <circle cx={s.x * w} cy={s.y * h} r={9} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </g>
      );
    case "arrow": {
      const x1 = s.x1 * w, y1 = s.y1 * h, x2 = s.x2 * w, y2 = s.y2 * h;
      const a = Math.atan2(y2 - y1, x2 - x1), head = 14;
      const p1 = [x2 + head * Math.cos(a + Math.PI - 0.45), y2 + head * Math.sin(a + Math.PI - 0.45)];
      const p2 = [x2 + head * Math.cos(a + Math.PI + 0.45), y2 + head * Math.sin(a + Math.PI + 0.45)];
      return <path d={`M${x1},${y1} L${x2},${y2} M${p1[0]},${p1[1]} L${x2},${y2} L${p2[0]},${p2[1]}`} {...common} strokeLinecap="round" strokeLinejoin="round" />;
    }
    case "rect":
      return <rect x={s.x * w} y={s.y * h} width={s.w * w} height={s.h * h} {...common} />;
    case "ellipse":
      return <ellipse cx={(s.x + s.w / 2) * w} cy={(s.y + s.h / 2) * h} rx={(s.w * w) / 2} ry={(s.h * h) / 2} {...common} />;
    case "path":
      return <polyline points={s.pts.map(([x, y]) => `${x * w},${y * h}`).join(" ")} {...common} strokeLinecap="round" strokeLinejoin="round" />;
    case "text":
      return (
        <text x={s.x * w} y={s.y * h} fill={color} fontSize={16} fontWeight={600} opacity={faded ? 0.35 : 1}
          style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{s.text}</text>
      );
  }
}

/**
 * Markierungen einer Seite (read-only) mit runden Nummern-Badges. Erledigte gedimmt mit Haken. Liegt exakt über dem
 * dargestellten Medium (Pixelmaß w×h, siehe useMediaRect).
 */
export function MarkupLayer({ items, w, h, activeId, onSelect, className, style }: {
  items: LayerItem[]; w: number; h: number; activeId?: string | null; onSelect?: (id: string) => void; className?: string;
  style?: React.CSSProperties;
}) {
  if (!w || !h) return null;
  return (
    <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", ...style }}>
      {items.map((it) => {
        const a = markupAnchor(it.markup);
        const active = it.id === activeId;
        return (
          <g key={it.id}>
            {it.markup.shapes.map((s, i) => <ShapeSvg key={i} s={s} color={it.markup.color} w={w} h={h} faded={it.done && !active} />)}
            <g transform={`translate(${a.x * w - 11}, ${a.y * h - 11})`} style={{ cursor: onSelect ? "pointer" : undefined, pointerEvents: onSelect ? "auto" : "none" }}
              onClick={(e) => { e.stopPropagation(); onSelect?.(it.id); }}>
              <circle cx={11} cy={11} r={active ? 13 : 11} fill={it.done ? "#16a34a" : it.markup.color} stroke="#fff" strokeWidth={2} />
              <text x={11} y={15} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">{it.done ? "✓" : it.number}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
