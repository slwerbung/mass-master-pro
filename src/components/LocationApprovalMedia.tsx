import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Loader2, ImageIcon, FileText } from "lucide-react";

// Reuse the same worker source proven in FloorPlanUpload.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface ApprovalPdf {
  url: string;       // signed URL of the production PDF
  name: string;      // display name
}

interface RenderedPage {
  src: string;       // data URL of the rendered page
  name: string;
}

// Module-level cache so re-mounts and the fullscreen view reuse already
// rendered pages instead of re-rasterising the same PDF.
const pageCache = new Map<string, RenderedPage[]>();

async function renderPdf(url: string, name: string): Promise<RenderedPage[]> {
  const cached = pageCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: RenderedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    // Cap the longest side to keep canvases reasonable for big print files.
    const scale = Math.min(2.5, 2000 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({
      src: canvas.toDataURL("image/jpeg", 0.85),
      name: doc.numPages > 1 ? `${name} · S.${i}` : name,
    });
  }
  pageCache.set(url, out);
  return out;
}

interface Props {
  annotatedUrl?: string;       // the original on-site photo (signed URL)
  pdfs: ApprovalPdf[];         // production PDFs (signed URLs)
  heightClass?: string;        // container height utility class
  big?: boolean;               // fullscreen sizing for controls
}

/**
 * Shows the production file(s) as the main image, page-flippable when there
 * are several pages. The original on-site photo is offered as a small
 * thumbnail in the corner (tap to peek). Falls back to just the photo when no
 * production file exists. Any orientation is letterboxed (object-contain).
 */
export function LocationApprovalMedia({ annotatedUrl, pdfs, heightClass, big }: Props) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasPdf = pdfs.some((p) => p.url);
  const pdfKey = pdfs.map((p) => p.url).join("|");

  // Render lazily once the card is near the viewport (many locations).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView || !hasPdf) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setFailed(false);
      const out: RenderedPage[] = [];
      for (const pdf of pdfs) {
        if (!pdf.url) continue;
        try {
          const rendered = await renderPdf(pdf.url, pdf.name);
          out.push(...rendered);
        } catch {
          /* skip a broken/missing pdf, keep going */
        }
      }
      if (cancelled) return;
      setPages(out);
      setLoading(false);
      if (out.length === 0) setFailed(true);
    })();
    return () => { cancelled = true; };
  }, [inView, hasPdf, pdfKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = heightClass || "h-72 sm:h-80";

  // No production file: behave like before — just the photo.
  if (!hasPdf) {
    return (
      <div ref={containerRef} className={`relative w-full ${h} bg-muted rounded-lg overflow-hidden flex items-center justify-center`}>
        {annotatedUrl
          ? <img src={annotatedUrl} alt="Standort" className="w-full h-full object-contain" />
          : <span className="text-sm text-muted-foreground">Kein Bild</span>}
      </div>
    );
  }

  const total = pages.length;
  const current = total > 0 ? pages[Math.min(idx, total - 1)] : null;
  const go = (d: number) => { setShowOriginal(false); setIdx((idx + d + total) % total); };

  return (
    <div ref={containerRef} className={`relative w-full ${h} bg-muted rounded-lg overflow-hidden flex items-center justify-center select-none`}>
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-xs">Druckdatei wird geladen…</span>
        </div>
      )}

      {!loading && failed && (
        <span className="text-sm text-muted-foreground px-4 text-center">Druckdatei konnte nicht angezeigt werden.</span>
      )}

      {!loading && !failed && (
        <>
          {showOriginal && annotatedUrl ? (
            <img src={annotatedUrl} alt="Original-Foto" className="w-full h-full object-contain" />
          ) : current ? (
            <img src={current.src} alt={current.name} className="w-full h-full object-contain" />
          ) : null}

          {/* Label top-left */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-background/85 backdrop-blur px-2 py-1 rounded-md text-xs font-medium shadow-sm">
            {showOriginal
              ? <><ImageIcon className="h-3.5 w-3.5 text-green-700" /> Original-Foto</>
              : <><FileText className="h-3.5 w-3.5 text-primary" /> {current?.name || "Druckdatei"}</>}
          </div>

          {/* Page arrows */}
          {!showOriginal && total > 1 && (
            <>
              <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/90 hover:bg-background rounded-full p-1.5 shadow-md">
                <ChevronLeft className={big ? "h-7 w-7" : "h-5 w-5"} />
              </button>
              <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/90 hover:bg-background rounded-full p-1.5 shadow-md">
                <ChevronRight className={big ? "h-7 w-7" : "h-5 w-5"} />
              </button>
            </>
          )}

          {/* Page dots */}
          {!showOriginal && total > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 bg-background/70 px-2 py-1 rounded-full">
              {pages.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)} className={`rounded-full transition-all ${i === idx ? "bg-foreground w-4 h-2" : "bg-muted-foreground/50 w-2 h-2"}`} />
              ))}
            </div>
          )}

          {/* Original photo thumbnail (small, bottom-right) */}
          {annotatedUrl && (
            <button
              onClick={() => setShowOriginal((v) => !v)}
              title={showOriginal ? "Zur Druckdatei" : "Original-Foto ansehen"}
              className="absolute bottom-2 right-2 w-16 h-16 rounded-md overflow-hidden border-2 border-background shadow-lg bg-muted hover:scale-105 transition-transform"
            >
              <img
                src={showOriginal && current ? current.src : annotatedUrl}
                alt="Vorschau"
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 text-[9px] text-center bg-black/55 text-white">
                {showOriginal ? "Druck" : "Foto"}
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
