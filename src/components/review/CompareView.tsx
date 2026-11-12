// Spec D2: zwei Versionen vergleichen – Nebeneinander (synchron), Schieberegler, Unterschiede (Pixel-Diff im Worker).
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { renderPdf } from "@/components/LocationApprovalMedia";
import { numberTopLevel, type MediaRef } from "@/lib/markup";
import { MarkupLayer, type LayerItem } from "./MarkupLayer";
import { useMediaRect } from "./useMediaRect";
import { clampView, doubleTap, IDENTITY, panBy, pinch, zoomAt, type View } from "./gestures";
import { aspectDiffers, canDiff, fitSize } from "./diff";
import { versionLabel } from "./versions";
import type { ReviewComment, ReviewVersion } from "./types";

type Mode = "side" | "slider" | "diff";
interface Page { src: string; name: string; ref: MediaRef }

const pagesCache = new Map<string, Promise<Page[]>>();
const diffCache = new Map<string, Promise<{ url: string; changed: number }>>();

/** Alle Seiten einer Version (PDF-Seiten aus dem gemeinsamen Cache, Bilder als eine Seite). */
function versionPages(v: ReviewVersion): Promise<Page[]> {
  const key = v.files.map((f) => f.storagePath).join("|");
  let p = pagesCache.get(key);
  if (!p) {
    p = (async () => {
      const out: Page[] = [];
      for (const f of v.files) {
        if (!f.url) continue;
        if (f.kind === "image") { out.push({ src: f.url, name: f.name, ref: { kind: "image", storagePath: f.storagePath } }); continue; }
        try {
          const r = await renderPdf(f.url, f.name, f.storagePath);
          r.forEach((x, i) => out.push({ src: x.src, name: x.name, ref: { kind: "pdf", storagePath: f.storagePath, page: i + 1 } }));
        } catch { /* kaputte Datei überspringen */ }
      }
      return out;
    })();
    pagesCache.set(key, p);
  }
  return p;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Bild nicht ladbar"));
    img.src = src;
  });
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: any) => void>();
function diffWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./diff.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
  }
  return worker;
}

/** Overlay der geänderten Pixel (PNG-URL) für ein Seitenpaar; im Modul-Cache je Paar. */
function computeDiff(oldSrc: string, newSrc: string, key: string): Promise<{ url: string; changed: number; aspect: boolean }> {
  let p = diffCache.get(key) as Promise<any> | undefined;
  if (!p) {
    p = (async () => {
      const [a, b] = await Promise.all([loadImage(oldSrc), loadImage(newSrc)]);
      const size = fitSize(b.naturalWidth, b.naturalHeight, 1600);
      const aspect = aspectDiffers({ w: a.naturalWidth, h: a.naturalHeight }, { w: b.naturalWidth, h: b.naturalHeight });
      const [ba, bb] = await Promise.all([createImageBitmap(a), createImageBitmap(b)]);
      const id = ++seq;
      const r: any = await new Promise((res) => { pending.set(id, res); diffWorker().postMessage({ id, a: ba, b: bb, w: size.w, h: size.h }, [ba, bb]); });
      if (!r.ok) throw new Error(r.error || "Vergleich fehlgeschlagen");
      return { url: URL.createObjectURL(r.blob), changed: r.changed, aspect };
    })();
    p.catch(() => diffCache.delete(key));
    diffCache.set(key, p);
  }
  return p;
}

/** Ein Medium (object-contain) mit optionalen Markierungen. */
function Pane({ page, items, label }: { page?: Page; items: LayerItem[]; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const rect = useMediaRect(boxRef, natural);
  return (
    <div ref={boxRef} className="absolute inset-0">
      {page ? (
        <>
          <img src={page.src} alt={label} draggable={false} className="h-full w-full select-none object-contain"
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {rect && items.length > 0 && (
            <div className="pointer-events-none absolute" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
              <MarkupLayer items={items} w={rect.w} h={rect.h} />
            </div>
          )}
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-neutral-700 text-sm text-neutral-200">Seite in {label} nicht vorhanden</div>
      )}
    </div>
  );
}

export default function CompareView({ versions, comments, onClose }: {
  versions: ReviewVersion[]; comments: ReviewComment[]; onClose: () => void;
}) {
  const sorted = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);
  const [rightNo, setRightNo] = useState(sorted[0]?.version);
  const [leftNo, setLeftNo] = useState(sorted[1]?.version ?? sorted[0]?.version);
  const left = sorted.find((v) => v.version === leftNo) ?? sorted[1];
  const right = sorted.find((v) => v.version === rightNo) ?? sorted[0];
  const diffOk = useMemo(() => canDiff(), []);
  const [mode, setMode] = useState<Mode>("side");
  const [showMarkup, setShowMarkup] = useState(false);
  const [leftPages, setLeftPages] = useState<Page[] | null>(null);
  const [rightPages, setRightPages] = useState<Page[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [view, setView] = useState<View>(IDENTITY);
  const [split, setSplit] = useState(50);
  const [diff, setDiff] = useState<{ url: string; changed: number; aspect: boolean } | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLeftPages(null); setRightPages(null);
    Promise.all([left ? versionPages(left) : Promise.resolve([]), right ? versionPages(right) : Promise.resolve([])]).then(([l, r]) => {
      if (!alive) return;
      setLeftPages(l); setRightPages(r);
    });
    return () => { alive = false; };
  }, [left, right]);

  const count = Math.max(leftPages?.length ?? 0, rightPages?.length ?? 0);
  const page = Math.min(idx, Math.max(0, count - 1));
  const lp = leftPages?.[page];
  const rp = rightPages?.[page];
  useEffect(() => { setView(IDENTITY); }, [page, leftNo, rightNo, mode]);

  useEffect(() => {
    setDiff(null); setDiffError(null);
    if (mode !== "diff" || !lp || !rp) return;
    let alive = true;
    setDiffBusy(true);
    computeDiff(lp.src, rp.src, `${lp.ref.storagePath}#${(lp.ref as any).page ?? 1}|${rp.ref.storagePath}#${(rp.ref as any).page ?? 1}`)
      .then((d) => { if (alive) setDiff(d); })
      .catch((e) => { if (alive) setDiffError(e?.message || "Vergleich fehlgeschlagen"); })
      .finally(() => { if (alive) setDiffBusy(false); });
    return () => { alive = false; };
  }, [mode, lp, rp]);

  const numbers = useMemo(() => numberTopLevel(comments), [comments]);
  const itemsFor = (p?: Page): LayerItem[] => (!showMarkup || !p) ? [] : comments
    .filter((c) => !c.parent_id && c.markup && c.media_ref && c.media_ref.storagePath === p.ref.storagePath
      && (p.ref.kind !== "pdf" || (c.media_ref.kind === "pdf" && c.media_ref.page === p.ref.page)))
    .map((c) => ({ id: c.id, number: numbers.get(c.id) ?? 0, markup: c.markup!, done: c.status === "done" }));

  // ---- Gesten: eine gemeinsame Ansicht für beide Seiten (synchron)
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; a0: { x: number; y: number }; b0: { x: number; y: number } } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const sp = (e: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clamp = (v: View, el: HTMLElement | null) => (el ? clampView(v, el.clientWidth, el.clientHeight) : v);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, sp(e));
      if (pointers.current.size === 2) {
        const [a0, b0] = [...pointers.current.values()];
        gesture.current = { start: view, a0, b0 };
        pan.current = null;
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const p = sp(e);
        setView((v) => clamp(doubleTap(v, p.x, p.y), e.currentTarget as HTMLElement));
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      pan.current = sp(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, sp(e));
      if (gesture.current && pointers.current.size >= 2) {
        const [a1, b1] = [...pointers.current.values()];
        const g = gesture.current;
        setView(pinch(g.start, g.a0, g.b0, a1, b1));
        return;
      }
      if (pan.current) {
        const p = sp(e);
        const dx = p.x - pan.current.x, dy = p.y - pan.current.y;
        pan.current = p;
        setView((v) => panBy(v, dx, dy));
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) gesture.current = null;
      if (pointers.current.size === 0) { pan.current = null; setView((v) => clamp(v, e.currentTarget as HTMLElement)); }
    },
    onWheel: (e: React.WheelEvent) => {
      const p = sp(e);
      const el = e.currentTarget as HTMLElement;
      setView((v) => clamp(zoomAt(v, Math.exp(-e.deltaY * 0.0015), p.x, p.y), el));
    },
  };
  const zoomButton = (f: number) => {
    const el = stageRef.current;
    if (!el) return;
    setView((v) => clampView(zoomAt(v, f, el.clientWidth / 2, el.clientHeight / 2), el.clientWidth, el.clientHeight));
  };
  const transform = { transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` };

  // Schieberegler: Trenner per Ziehen (Prozent der Bühne)
  const dragging = useRef(false);
  const moveSplit = (e: React.PointerEvent) => {
    if (!dragging.current || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    // Position im (gezoomten) Inhalt
    const x = (e.clientX - r.left - view.tx) / view.scale;
    setSplit(Math.min(100, Math.max(0, (x / r.width) * 100)));
  };

  const loading = !leftPages || !rightPages;
  const modeBtn = (m: Mode, label: string) => (
    <Button key={m} size="sm" variant={mode === m ? "secondary" : "ghost"} className="h-8 px-2 text-xs text-white" onClick={() => setMode(m)}>{label}</Button>
  );
  const select = (value: number | undefined, onChange: (n: number) => void, title: string) => (
    <select className="h-8 max-w-[40vw] rounded border border-neutral-600 bg-neutral-800 px-1.5 text-xs text-white" value={value ?? ""} title={title}
      onChange={(e) => onChange(Number(e.target.value))}>
      {sorted.map((v) => <option key={v.version} value={v.version}>{versionLabel(v)}</option>)}
    </select>
  );

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-neutral-900 text-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-700 px-3 py-2">
        <span className="font-semibold">Vergleichen</span>
        {select(leftNo, setLeftNo, "Links / vorher")}
        <span className="text-xs text-neutral-400">↔</span>
        {select(rightNo, setRightNo, "Rechts / nachher")}
        <div className="flex rounded bg-neutral-800 p-0.5">
          {modeBtn("side", "Nebeneinander")}
          {modeBtn("slider", "Schieberegler")}
          {diffOk && modeBtn("diff", "Unterschiede")}
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={showMarkup} onChange={(e) => setShowMarkup(e.target.checked)} disabled={mode === "diff"} /> Markierungen zeigen
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-white" onClick={() => zoomButton(1 / 1.5)} title="Verkleinern"><ZoomOut className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="text-white" onClick={() => zoomButton(1.5)} title="Vergrößern"><ZoomIn className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="text-white" onClick={onClose} title="Vergleich schließen"><X className="h-5 w-5" /></Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {!loading && mode === "side" && (
          <div className="flex h-full flex-col md:flex-row">
            {[{ p: lp, v: left }, { p: rp, v: right }].map(({ p, v }, i) => (
              <div key={i} className="relative min-h-0 flex-1 overflow-hidden border-neutral-700 md:border-r" style={{ touchAction: "none" }}
                ref={i === 1 ? stageRef : undefined} {...handlers} onPointerCancel={handlers.onPointerUp}>
                <div className="absolute inset-0 origin-top-left" style={transform}>
                  <Pane page={p} items={itemsFor(p)} label={`v${v?.version}`} />
                </div>
                <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">v{v?.version}</span>
              </div>
            ))}
          </div>
        )}
        {!loading && mode === "slider" && (
          <div ref={stageRef} className="relative h-full overflow-hidden" style={{ touchAction: "none" }}
            {...handlers} onPointerCancel={handlers.onPointerUp}>
            <div className="absolute inset-0 origin-top-left" style={transform}>
              <Pane page={lp} items={itemsFor(lp)} label={`v${left?.version}`} />
              <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                <Pane page={rp} items={itemsFor(rp)} label={`v${right?.version}`} />
              </div>
              <div className="absolute inset-y-0 z-10 w-0.5 bg-white shadow" style={{ left: `${split}%` }}>
                <div className="absolute top-1/2 -ml-4 -mt-4 flex h-8 w-8 cursor-ew-resize items-center justify-center rounded-full bg-white text-xs font-bold text-black shadow"
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => { e.stopPropagation(); dragging.current = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }}
                  onPointerMove={(e) => { e.stopPropagation(); moveSplit(e); }}
                  onPointerUp={(e) => { e.stopPropagation(); dragging.current = false; }}
                  onPointerCancel={() => { dragging.current = false; }}>⇔</div>
              </div>
            </div>
            <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">v{left?.version}</span>
            <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">v{right?.version}</span>
          </div>
        )}
        {!loading && mode === "diff" && (
          <div ref={stageRef} className="relative h-full overflow-hidden" style={{ touchAction: "none" }}
            {...handlers} onPointerCancel={handlers.onPointerUp}>
            <div className="absolute inset-0 origin-top-left" style={transform}>
              <Pane page={rp} items={[]} label={`v${right?.version}`} />
              {diff && <img src={diff.url} alt="Unterschiede" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />}
            </div>
            <div className="absolute left-2 top-2 space-y-1 text-xs">
              {diffBusy && <span className="inline-flex items-center gap-1 rounded bg-black/60 px-2 py-0.5"><Loader2 className="h-3 w-3 animate-spin" /> Vergleiche …</span>}
              {diff && <span className="block rounded bg-black/60 px-2 py-0.5">{diff.changed ? "Rot = geändert gegenüber " : "Keine Unterschiede zu "}v{left?.version}</span>}
              {diff?.aspect && <span className="block rounded bg-amber-600/90 px-2 py-0.5">Format geändert – Vergleich ungenau</span>}
              {(!lp || !rp) && <span className="block rounded bg-black/60 px-2 py-0.5">Seite fehlt in einer Version</span>}
              {diffError && <span className="block rounded bg-red-700/90 px-2 py-0.5">{diffError}</span>}
            </div>
          </div>
        )}
        {count > 1 && (
          <>
            <button className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow" onClick={() => setIdx((page - 1 + count) % count)}>
              <ChevronLeft className="h-5 w-5 text-black" />
            </button>
            <button className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow" onClick={() => setIdx((page + 1) % count)}>
              <ChevronRight className="h-5 w-5 text-black" />
            </button>
            <span className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs">Seite {page + 1}/{count}</span>
          </>
        )}
      </div>
    </div>
  );
}
