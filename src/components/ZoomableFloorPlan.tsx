import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Maximize } from "lucide-react";

interface Props {
  src: string;
  alt: string;
  /** Kreuz-Cursor: ein Tippen setzt einen Marker statt zu verschieben. */
  placing?: boolean;
  /** Relative Koordinaten (0..1) der angetippten Stelle. */
  onPlace?: (x: number, y: number) => void;
  /**
   * Marker und anderes Beiwerk. Bekommt den aktuellen Zoom, damit die
   * Beschriftung gegenskaliert werden kann – ein Marker soll beim Hineinzoomen
   * nicht mitwachsen, sondern gleich gross bleiben.
   */
  children?: (zoom: number) => React.ReactNode;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Ab dieser Bewegung gilt eine Geste als Verschieben, nicht als Tippen. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Grundriss mit Zoom und Verschieben.
 *
 * Ohne Zoom ist ein A1-Architektenplan auf einem Handy nicht bedienbar: Räume
 * sind nicht lesbar, und zwei Schilder an derselben Flurkreuzung liegen als
 * Marker übereinander. Bedienung: Mausrad oder Pinch zum Zoomen, Ziehen zum
 * Verschieben, Doppeltipp zum Hineinzoomen.
 *
 * Der wichtigste Punkt ist die Trefferpunkt-Rechnung: Die relativen
 * Koordinaten werden aus dem **Bild** und nicht aus dem Rahmen berechnet.
 * `getBoundingClientRect()` liefert die bereits transformierte Box – damit
 * stimmt die Stelle bei jedem Zoomstand, ganz ohne eigene Umrechnung.
 */
const ZoomableFloorPlan = ({ src, alt, placing = false, onPlace, children }: Props) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Laufende Gesten. Als Ref, damit ein Zwischenrendern sie nicht verliert.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number; startY: number;
    startOffset: { x: number; y: number };
    startDistance: number; startZoom: number;
    moved: boolean;
  } | null>(null);

  // Planwechsel: zurueck auf die Uebersicht.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  /**
   * Verschiebung begrenzen, damit der Plan nicht aus dem Bild wandert.
   * Erlaubt ist so viel, dass immer ein Viertel sichtbar bleibt.
   */
  const clampOffset = useCallback((next: { x: number; y: number }, atZoom: number) => {
    const frame = frameRef.current;
    if (!frame) return next;
    const { width, height } = frame.getBoundingClientRect();
    const overflowX = Math.max(0, width * atZoom - width);
    const overflowY = Math.max(0, height * atZoom - height);
    const slack = 0.25;
    return {
      x: Math.min(width * slack, Math.max(-overflowX - width * slack, next.x)),
      y: Math.min(height * slack, Math.max(-overflowY - height * slack, next.y)),
    };
  }, []);

  /** Zoomt so, dass der Punkt unter dem Finger an Ort und Stelle bleibt. */
  const zoomAt = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    setZoom((currentZoom) => {
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      setOffset((currentOffset) => {
        if (target === MIN_ZOOM) return { x: 0, y: 0 };
        const ratio = target / currentZoom;
        return clampOffset(
          { x: px - (px - currentOffset.x) * ratio, y: py - (py - currentOffset.y) * ratio },
          target,
        );
      });
      return target;
    });
  }, [clampOffset]);

  const resetView = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  const handleWheel = (event: React.WheelEvent) => {
    // Nur zoomen, nicht die Seite scrollen.
    event.preventDefault();
    zoomAt(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY);
  };

  const distanceBetweenPointers = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = {
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
      startDistance: pointers.current.size === 2 ? distanceBetweenPointers() : 0,
      startZoom: zoom,
      moved: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    if (!state) return;

    // Zwei Finger: Pinch.
    if (pointers.current.size === 2) {
      const distance = distanceBetweenPointers();
      if (state.startDistance === 0) {
        state.startDistance = distance;
        state.startZoom = zoom;
        return;
      }
      state.moved = true;
      const [a, b] = [...pointers.current.values()];
      zoomAt(state.startZoom * (distance / state.startDistance), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    state.moved = true;

    // Im Platzieren-Modus bei Zoomstufe 1 gibt es nichts zu verschieben –
    // dann bleibt das Tippen ein Tippen.
    if (placing && zoom === MIN_ZOOM) return;
    setOffset(clampOffset({ x: state.startOffset.x + dx, y: state.startOffset.y + dy }, zoom));
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    const state = gesture.current;
    pointers.current.delete(event.pointerId);
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* schon frei */ }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!state || state.moved) return;

    // Ein Tippen ohne Bewegung: Marker setzen.
    if (!placing || !onPlace || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return; // neben den Plan getippt
    onPlace(x, y);
  };

  const handleDoubleClick = (event: React.MouseEvent) => {
    if (zoom >= MAX_ZOOM) resetView();
    else zoomAt(zoom * 2, event.clientX, event.clientY);
  };

  return (
    <div className="relative">
      <div
        ref={frameRef}
        className={`relative bg-muted rounded-lg overflow-hidden border-2 touch-none select-none ${
          placing ? "border-primary cursor-crosshair" : zoom > 1 ? "border-transparent cursor-grab" : "border-transparent"
        }`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <img ref={imageRef} src={src} alt={alt} className="w-full h-auto block" draggable={false} />
          {children?.(zoom)}
        </div>
      </div>

      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <Button
          variant="secondary" size="icon"
          className="h-9 w-9 shadow-md"
          onClick={() => zoomAt(zoom * 1.5, ...frameCenter(frameRef))}
          disabled={zoom >= MAX_ZOOM}
          title="Vergrößern"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary" size="icon"
          className="h-9 w-9 shadow-md"
          onClick={() => zoomAt(zoom / 1.5, ...frameCenter(frameRef))}
          disabled={zoom <= MIN_ZOOM}
          title="Verkleinern"
        >
          <Minus className="h-4 w-4" />
        </Button>
        {zoom > MIN_ZOOM && (
          <Button variant="secondary" size="icon" className="h-9 w-9 shadow-md" onClick={resetView} title="Ganzer Plan">
            <Maximize className="h-4 w-4" />
          </Button>
        )}
      </div>

      {zoom > MIN_ZOOM && (
        <span className="absolute bottom-2 left-2 rounded bg-background/80 px-2 py-0.5 text-xs text-muted-foreground shadow-sm">
          {Math.round(zoom * 100)} %
        </span>
      )}
    </div>
  );
};

/** Mittelpunkt des Rahmens – die Knöpfe zoomen dorthin, nicht an den Rand. */
function frameCenter(ref: React.RefObject<HTMLDivElement>): [number, number] {
  const rect = ref.current?.getBoundingClientRect();
  if (!rect) return [0, 0];
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

export default ZoomableFloorPlan;
