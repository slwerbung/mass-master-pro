import { useEffect, useState, type RefObject } from "react";
import { containRect } from "@/lib/markup";

/** Tatsächlich dargestelltes Rechteck eines object-contain-Mediums im Container (Letterboxing), folgt Größenänderungen. */
export function useMediaRect(containerRef: RefObject<HTMLElement>, natural: { w: number; h: number } | null) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !natural) { setRect(null); return; }
    const update = () => setRect(containRect({ w: el.clientWidth, h: el.clientHeight }, natural));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, natural?.w, natural?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  return rect;
}
