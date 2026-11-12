import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight, Check, ChevronLeft, ChevronRight, Circle, Hand, Loader2, MapPin, MessageSquare, Pencil, RotateCcw,
  Send, Square, Trash2, Type, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { renderPdf } from "@/components/LocationApprovalMedia";
import {
  DEFAULT_MARKUP_COLOR, MARKUP_COLORS, MAX_SHAPES, numberTopLevel, simplifyPath, type MediaRef, type Shape,
} from "@/lib/markup";
import { MarkupLayer, ShapeSvg, type LayerItem } from "./MarkupLayer";
import { useMediaRect } from "./useMediaRect";
import { clampView, discardStroke, doubleTap, IDENTITY, panBy, pinch, zoomAt, type View } from "./gestures";
import { isOpenTop, type ReviewComment, type ReviewFile, type ReviewSource } from "./types";
import { versionLabel, versionOfPath } from "./versions";
import CompareView from "./CompareView";

type Tool = "pin" | "arrow" | "rect" | "ellipse" | "path" | "text";
interface Page { src: string; name: string; ref: MediaRef }

const sameRef = (a?: MediaRef | null, b?: MediaRef | null) =>
  !!a && !!b && a.kind === b.kind && a.storagePath === b.storagePath && (a.kind !== "pdf" || (b.kind === "pdf" && a.page === b.page));

const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const TOOLS: { t: Tool; icon: typeof MapPin; label: string }[] = [
  { t: "pin", icon: MapPin, label: "Pin" }, { t: "arrow", icon: ArrowUpRight, label: "Pfeil" }, { t: "rect", icon: Square, label: "Rechteck" },
  { t: "ellipse", icon: Circle, label: "Ellipse" }, { t: "path", icon: Pencil, label: "Freihand" }, { t: "text", icon: Type, label: "Text" },
];

/**
 * Vollbild-Prüfmodus (Spec C): Druckdatei/Foto mit Markierungen, Zeichnen (Maus und Touch), nummerierte Kommentare
 * mit Antworten. Zwei Finger zoomen/verschieben immer – auch mit aktivem Werkzeug; ein Finger zeichnet bzw. verschiebt.
 */
export default function ReviewViewer({ open, onOpenChange, source, title, initialRef, startDrawing, onChanged, footer }: {
  open: boolean; onOpenChange: (v: boolean) => void; source: ReviewSource; title: string;
  initialRef?: MediaRef | null; startDrawing?: boolean;
  /** nach jeder Änderung (z. B. Zähler/Chat neu laden) */
  onChanged?: () => void;
  /** z. B. Freigabe-Nachweis unter der Kommentarliste */
  footer?: React.ReactNode;
}) {
  // Spec D1: Versionswahl. Standard = aktuelle Version; ältere nur ansehen/antworten.
  const versions = source.versions && source.versions.length > 0 ? source.versions : null;
  const currentVersionNo = versions?.find((v) => v.current)?.version ?? versions?.[0]?.version ?? null;
  const [versionNo, setVersionNo] = useState<number | null>(() => versionOfPath(versions ?? undefined, initialRef?.storagePath)?.version ?? currentVersionNo);
  const selectedVersion = versions?.find((v) => v.version === versionNo) ?? versions?.find((v) => v.current) ?? null;
  const isCurrentView = !versions || !selectedVersion || selectedVersion.current;
  const versionedPaths = useMemo(() => new Set((versions ?? []).flatMap((v) => v.files.map((f) => f.storagePath))), [versions]);
  const viewFiles: ReviewFile[] = useMemo(() => !versions ? source.files : [
    ...(selectedVersion?.files ?? []),
    ...source.files.filter((f) => !versionedPaths.has(f.storagePath)),
  ], [source.files, versions, selectedVersion, versionedPaths]);
  const viewKey = viewFiles.map((f) => f.storagePath).join("|");
  const [comparing, setComparing] = useState(false);

  const [pages, setPages] = useState<Page[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [idx, setIdx] = useState(0);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"alle" | "offen" | "erledigt">("alle");
  const [tool, setTool] = useState<Tool | null>(startDrawing ? "rect" : null);
  const [color, setColor] = useState<string>(DEFAULT_MARKUP_COLOR);
  const [draft, setDraft] = useState<Shape[]>([]);
  const [drawing, setDrawing] = useState<Shape | null>(null);
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [message, setMessage] = useState("");
  const [general, setGeneral] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>(IDENTITY);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rect = useMediaRect(boxRef, natural);
  const page = pages[Math.min(idx, Math.max(0, pages.length - 1))];
  const isEmployee = source.viewerSide === "employee";

  // Seiten aller Dateien (PDF-Seiten aus dem Cache der Karte, Bilder direkt).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoadingPages(true);
      const out: Page[] = [];
      for (const f of viewFiles) {
        if (!f.url) continue;
        if (f.kind === "image") { out.push({ src: f.url, name: f.name, ref: { kind: "image", storagePath: f.storagePath } }); continue; }
        try {
          const rendered = await renderPdf(f.url, f.name, f.storagePath);
          rendered.forEach((r, i) => out.push({ src: r.src, name: r.name, ref: { kind: "pdf", storagePath: f.storagePath, page: i + 1 } }));
        } catch { /* kaputte Datei überspringen */ }
      }
      if (!alive) return;
      setPages(out);
      const start = initialRef ? out.findIndex((p) => sameRef(p.ref, initialRef)) : -1;
      setIdx(start >= 0 ? start : 0);
      setLoadingPages(false);
    })();
    return () => { alive = false; };
  }, [open, source, viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    try { setComments(await source.list()); } catch (e: any) { toast.error(e?.message || "Kommentare konnten nicht geladen werden"); }
  }, [source]);
  useEffect(() => {
    if (!open) return;
    reload();
    return source.subscribe?.(() => reload());
  }, [open, source, reload]);

  useEffect(() => { setView(IDENTITY); setNatural(null); setDraft([]); setDrawing(null); setTextPos(null); }, [idx]);
  // Ältere Version: keine Werkzeuge.
  useEffect(() => { if (!isCurrentView) { setTool(null); setDraft([]); setDrawing(null); setTextPos(null); } }, [isCurrentView]);

  const numbers = useMemo(() => numberTopLevel(comments), [comments]);
  const knownPaths = useMemo(() => new Set([...source.files.map((f) => f.storagePath), ...versionedPaths]), [source.files, versionedPaths]);
  const viewPaths = useMemo(() => new Set(viewFiles.map((f) => f.storagePath)), [viewFiles]);
  /** Markierung gehört zu einer anderen (noch vorhandenen) Version als der gezeigten */
  const otherVersion = useCallback((c: ReviewComment) => !!c.media_ref && knownPaths.has(c.media_ref.storagePath) && !viewPaths.has(c.media_ref.storagePath), [knownPaths, viewPaths]);
  const tops = useMemo(() => comments.filter((c) => !c.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [comments]);
  const repliesOf = useCallback((id: string) => comments.filter((c) => c.parent_id === id), [comments]);
  const layerItems: LayerItem[] = useMemo(() => !page ? [] : tops
    .filter((c) => c.markup && sameRef(c.media_ref, page.ref) && c.id !== editingId)
    .map((c) => ({ id: c.id, number: numbers.get(c.id) ?? 0, markup: c.markup!, done: c.status === "done" })), [tops, page, numbers, editingId]);

  // ------------------------------------------------------------------ Zeichnen & Gesten
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; a0: { x: number; y: number }; b0: { x: number; y: number } } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const stroke = useRef<{ id: number; startedAt: number; start: [number, number] } | null>(null);
  const lastTap = useRef(0);

  const stagePoint = (e: React.PointerEvent | React.WheelEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const normPoint = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const r = overlayRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const clampToStage = (v: View) => {
    const el = stageRef.current;
    return el ? clampView(v, el.clientWidth, el.clientHeight) : v;
  };
  const commitShape = (s: Shape | null) => {
    if (!s) return;
    if (s.t === "path") {
      const pts = simplifyPath(s.pts);
      if (pts.length < 2) return;
      s = { t: "path", pts };
    }
    if ((s.t === "rect" || s.t === "ellipse") && (s.w < 0.005 || s.h < 0.005)) return;
    if (s.t === "arrow" && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 0.01) return;
    setDraft((d) => (d.length >= MAX_SHAPES ? d : [...d, s!]));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!page) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, stagePoint(e));
    if (pointers.current.size === 2) {
      // Zweiter Finger: Geste. Ein gerade erst begonnener Strich war ein Versehen.
      if (stroke.current) {
        if (!discardStroke(stroke.current.startedAt, Date.now())) commitShape(drawing);
        stroke.current = null;
        setDrawing(null);
      }
      const [a0, b0] = [...pointers.current.values()];
      gesture.current = { start: view, a0, b0 };
      pan.current = null;
      return;
    }
    if (pointers.current.size > 2) return;
    if (tool) {
      const p = normPoint(e);
      if (!p) return;
      if (tool === "pin") { commitShape({ t: "pin", x: p[0], y: p[1] }); return; }
      if (tool === "text") { setTextPos({ x: p[0], y: p[1] }); setTextValue(""); return; }
      stroke.current = { id: e.pointerId, startedAt: Date.now(), start: p };
      if (tool === "path") setDrawing({ t: "path", pts: [p] });
      else if (tool === "arrow") setDrawing({ t: "arrow", x1: p[0], y1: p[1], x2: p[0], y2: p[1] });
      else setDrawing({ t: tool, x: p[0], y: p[1], w: 0, h: 0 });
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 300) {
      const sp = stagePoint(e);
      setView((v) => clampToStage(doubleTap(v, sp.x, sp.y)));
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    pan.current = stagePoint(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, stagePoint(e));
    if (gesture.current && pointers.current.size >= 2) {
      const [a1, b1] = [...pointers.current.values()];
      const g = gesture.current;
      setView(pinch(g.start, g.a0, g.b0, a1, b1));
      return;
    }
    if (stroke.current && stroke.current.id === e.pointerId) {
      const p = normPoint(e);
      if (!p) return;
      const [sx, sy] = stroke.current.start;
      setDrawing((d) => {
        if (!d) return d;
        if (d.t === "path") return d.pts.length > 1500 ? d : { t: "path", pts: [...d.pts, p] };
        if (d.t === "arrow") return { ...d, x2: p[0], y2: p[1] };
        if (d.t === "rect" || d.t === "ellipse") return { t: d.t, x: Math.min(sx, p[0]), y: Math.min(sy, p[1]), w: Math.abs(p[0] - sx), h: Math.abs(p[1] - sy) };
        return d;
      });
      return;
    }
    if (pan.current) {
      const sp = stagePoint(e);
      const dx = sp.x - pan.current.x, dy = sp.y - pan.current.y;
      pan.current = sp;
      setView((v) => panBy(v, dx, dy));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (stroke.current && stroke.current.id === e.pointerId) {
      commitShape(drawing);
      setDrawing(null);
      stroke.current = null;
    }
    if (pointers.current.size < 2 && gesture.current) {
      gesture.current = null;
      setView((v) => clampToStage(v));
    }
    if (pointers.current.size === 0) { pan.current = null; setView((v) => clampToStage(v)); }
  };

  const onWheel = (e: React.WheelEvent) => {
    const sp = stagePoint(e);
    setView((v) => clampToStage(zoomAt(v, Math.exp(-e.deltaY * 0.0015), sp.x, sp.y)));
  };
  const zoomButton = (f: number) => {
    const el = stageRef.current;
    if (!el) return;
    setView((v) => clampToStage(zoomAt(v, f, el.clientWidth / 2, el.clientHeight / 2)));
  };

  // ------------------------------------------------------------------ Aktionen
  const resetDraft = () => { setDraft([]); setDrawing(null); setTextPos(null); setMessage(""); setEditingId(null); };
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await reload(); onChanged?.(); return true; }
    catch (e: any) { toast.error(e?.message || "Das hat nicht geklappt"); return false; }
    finally { setBusy(false); }
  };

  const sendMarkup = async () => {
    if (!page || !draft.length || !message.trim()) return;
    const markup = { v: 1 as const, color, shapes: draft };
    const ok = editingId
      ? await run(() => source.update(editingId, { markup, message: message.trim() }), "Markierung geändert")
      : await run(() => source.create({ message: message.trim(), markup, mediaRef: page.ref }), "Korrektur gesendet");
    if (ok) { resetDraft(); setTool(null); }
  };
  const sendGeneral = async () => {
    if (!general.trim()) return;
    if (await run(() => source.create({ message: general.trim() }))) setGeneral("");
  };
  const sendReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    if (await run(() => source.create({ message: replyText.trim(), parentId }))) { setReplyText(""); setReplyTo(null); }
  };
  const startEdit = (c: ReviewComment) => {
    if (!c.markup || !c.media_ref) return;
    const target = pages.findIndex((p) => sameRef(p.ref, c.media_ref));
    if (target < 0) return;
    setIdx(target);
    // Nach dem Seitenwechsel (Effekt oben leert den Entwurf) den Entwurf befüllen.
    setTimeout(() => { setDraft(c.markup!.shapes); setColor(c.markup!.color); setMessage(c.message); setEditingId(c.id); setTool("rect"); }, 0);
  };
  const jumpTo = (c: ReviewComment) => {
    setActiveId(c.id);
    if (c.media_ref) {
      const target = pages.findIndex((p) => sameRef(p.ref, c.media_ref));
      if (target >= 0) setIdx(target);
    }
  };
  const selectBadge = (id: string) => {
    setActiveId(id);
    document.getElementById(`review-c-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const visibleTops = tops.filter((c) => !otherVersion(c)).filter((c) => filter === "alle" || (filter === "offen" ? isOpenTop(c) : c.status === "done"));
  const fromOtherVersions = versions ? tops.filter((c) => otherVersion(c) && isOpenTop(c)) : [];
  const [showOther, setShowOther] = useState(false);
  const switchToComment = (c: ReviewComment) => {
    const v = versionOfPath(versions ?? undefined, c.media_ref?.storagePath);
    if (!v) return;
    setVersionNo(v.version);
    setActiveId(c.id);
    // Seiten der Version werden neu aufgebaut; danach auf die Markierung springen.
    setTimeout(() => setActiveId(c.id), 0);
  };
  const withMarkup = visibleTops.filter((c) => c.markup);
  const generalTops = visibleTops.filter((c) => !c.markup);
  const openCount = tops.filter(isOpenTop).length;

  const renderComment = (c: ReviewComment) => {
    const n = numbers.get(c.id);
    const outdated = !!c.media_ref && !knownPaths.has(c.media_ref.storagePath);
    const own = source.isOwn(c) && (c.status ?? "open") === "open";
    const done = c.status === "done";
    return (
      <div key={c.id} id={`review-c-${c.id}`}
        className={`rounded-lg border p-2.5 text-sm ${activeId === c.id ? "border-primary ring-1 ring-primary" : ""} ${done ? "opacity-70" : ""}`}
        onClick={() => jumpTo(c)}>
        <div className="flex items-center gap-2">
          {c.markup && (
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: done ? "#16a34a" : c.markup.color }}>{done ? "✓" : n}</span>
          )}
          <span className="truncate text-xs font-medium">{c.author_name}</span>
          <span className="text-[10px] text-muted-foreground">{fmt(c.created_at)}</span>
          {!c.legacy && (
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${done ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{done ? "Umgesetzt" : "Offen"}</span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words">{c.message}</p>
        {outdated && <p className="mt-1 text-[11px] text-muted-foreground">bezieht sich auf eine gelöschte Datei</p>}
        {repliesOf(c.id).map((r) => (
          <div key={r.id} className="mt-2 ml-4 border-l-2 pl-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{r.author_name}</span>
              <span className="text-[10px] text-muted-foreground">{fmt(r.created_at)}</span>
              {source.isOwn(r) && (
                <button className="ml-auto text-[10px] text-destructive/80 hover:text-destructive" disabled={busy}
                  onClick={(e) => { e.stopPropagation(); run(() => source.remove(r.id)); }}>löschen</button>
              )}
            </div>
            <p className="whitespace-pre-wrap break-words">{r.message}</p>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]" onClick={(e) => e.stopPropagation()}>
          {!c.legacy && <button className="text-muted-foreground hover:text-foreground" onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); }}>Antworten</button>}
          {isEmployee && source.toggle && !c.legacy && (
            <button className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" disabled={busy}
              onClick={() => run(() => source.toggle!(c.id, done ? "open" : "done"))}>
              {done ? <><RotateCcw className="h-3 w-3" /> öffnen</> : <><Check className="h-3 w-3" /> erledigt</>}
            </button>
          )}
          {own && c.markup && !outdated && isCurrentView && <button className="text-muted-foreground hover:text-foreground" onClick={() => startEdit(c)}>Markierung ändern</button>}
          {own && (
            <button className="inline-flex items-center gap-0.5 text-destructive/80 hover:text-destructive" disabled={busy}
              onClick={() => { if (confirm("Kommentar löschen? Antworten werden mitgelöscht.")) run(() => source.remove(c.id)); }}>
              <Trash2 className="h-3 w-3" /> löschen
            </button>
          )}
        </div>
        {replyTo === c.id && (
          <div className="mt-2 flex items-end gap-2" onClick={(e) => e.stopPropagation()}>
            <Textarea rows={2} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Antwort…" className="resize-none text-sm" autoFocus />
            <Button size="icon" disabled={busy || !replyText.trim()} onClick={() => sendReply(c.id)}><Send className="h-4 w-4" /></Button>
          </div>
        )}
      </div>
    );
  };

  const w = rect?.w ?? 0, h = rect?.h ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetDraft(); setTool(null); } onOpenChange(v); }}>
      <DialogContent className="flex h-[100dvh] max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:rounded-none [&>button]:hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {comparing && versions && <CompareView versions={versions} comments={comments} onClose={() => setComparing(false)} />}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="truncate font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground">{openCount} offen</span>
          {versions && versions.length > 0 && (
            <select className="ml-2 h-8 max-w-[52vw] rounded border bg-background px-1.5 text-xs" value={selectedVersion?.version ?? ""}
              onChange={(e) => { setVersionNo(Number(e.target.value)); resetDraft(); setTool(null); }} title="Version">
              {versions.map((v) => <option key={v.version} value={v.version}>{versionLabel(v)}</option>)}
            </select>
          )}
          {versions && versions.length >= 2 && (
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { resetDraft(); setTool(null); setComparing(true); }}>Vergleichen</Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => zoomButton(1 / 1.5)} title="Verkleinern"><ZoomOut className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => zoomButton(1.5)} title="Vergrößern"><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} title="Schließen"><X className="h-5 w-5" /></Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Medium */}
          <div className="relative flex h-[60%] min-h-0 flex-col bg-neutral-900 md:h-auto md:flex-1">
            <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden" style={{ touchAction: "none" }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
              {loadingPages && <div className="absolute inset-0 flex items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>}
              {!loadingPages && !page && <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300">Keine Datei zum Markieren.</div>}
              {page && (
                <div ref={boxRef} className="absolute inset-0 origin-top-left"
                  style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, cursor: tool ? "crosshair" : view.scale > 1 ? "grab" : "default" }}>
                  <img src={page.src} alt={page.name} draggable={false} className="h-full w-full select-none object-contain"
                    onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
                  {rect && (
                    <div ref={overlayRef} className="absolute" style={{ left: rect.x, top: rect.y, width: w, height: h }}>
                      <MarkupLayer className="absolute inset-0" items={layerItems} w={w} h={h} activeId={activeId} onSelect={tool ? undefined : selectBadge} />
                      <svg className="pointer-events-none absolute inset-0" width={w} height={h} style={{ overflow: "visible" }}>
                        {[...draft, ...(drawing ? [drawing] : [])].map((s, i) => <ShapeSvg key={i} s={s} color={color} w={w} h={h} />)}
                      </svg>
                      {textPos && (
                        <div className="absolute z-10" style={{ left: textPos.x * w, top: textPos.y * h }} onPointerDown={(e) => e.stopPropagation()}>
                          <input autoFocus maxLength={200} value={textValue} onChange={(e) => setTextValue(e.target.value)}
                            placeholder="Text…" className="w-40 rounded border bg-white px-1.5 py-0.5 text-sm text-black shadow"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && textValue.trim()) { commitShape({ t: "text", x: textPos.x, y: textPos.y, text: textValue.trim() }); setTextPos(null); }
                              if (e.key === "Escape") setTextPos(null);
                            }}
                            onBlur={() => { if (textValue.trim()) commitShape({ t: "text", x: textPos.x, y: textPos.y, text: textValue.trim() }); setTextPos(null); }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {pages.length > 1 && (
                <>
                  <button className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow" onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setIdx((idx - 1 + pages.length) % pages.length)}><ChevronLeft className="h-5 w-5 text-black" /></button>
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow" onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setIdx((idx + 1) % pages.length)}><ChevronRight className="h-5 w-5 text-black" /></button>
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{page?.name} · {idx + 1}/{pages.length}</span>
                </>
              )}
            </div>
            {selectedVersion?.note && (
              <div className="border-t border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-200">Änderung v{selectedVersion.version}: {selectedVersion.note}</div>
            )}
            {!isCurrentView && (
              <div className="flex items-center gap-2 border-t border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-amber-200">
                Markieren nur auf der aktuellen Version.
                {currentVersionNo != null && <button className="underline" onClick={() => setVersionNo(currentVersionNo)}>Zur aktuellen v{currentVersionNo}</button>}
              </div>
            )}
            {/* Werkzeuge */}
            {isCurrentView && <div className="flex flex-wrap items-center gap-1 border-t border-neutral-700 bg-neutral-800 px-2 py-1.5 text-white">
              <Button size="sm" variant={tool === null ? "secondary" : "ghost"} className="h-8 px-2 text-white" onClick={() => setTool(null)} title="Ansehen / verschieben">
                <Hand className="h-4 w-4" />
              </Button>
              {TOOLS.map(({ t, icon: I, label }) => (
                <Button key={t} size="sm" variant={tool === t ? "secondary" : "ghost"} className="h-8 px-2 text-white" title={label} onClick={() => setTool(t)}>
                  <I className="h-4 w-4" />
                </Button>
              ))}
              <span className="mx-1 h-5 w-px bg-neutral-600" />
              {MARKUP_COLORS.map((c) => (
                <button key={c} title="Farbe" onClick={() => setColor(c)} className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
              ))}
              <span className="mx-1 h-5 w-px bg-neutral-600" />
              <Button size="sm" variant="ghost" className="h-8 px-2 text-white" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))} title="Rückgängig"><Undo2 className="h-4 w-4" /></Button>
              {(draft.length > 0 || editingId) && <Button size="sm" variant="ghost" className="h-8 px-2 text-white" onClick={() => { resetDraft(); setTool(null); }}>Abbrechen</Button>}
            </div>}
            {draft.length > 0 && (
              <div className="flex items-end gap-2 border-t border-neutral-700 bg-neutral-800 p-2">
                <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className="resize-none bg-white text-sm text-black"
                  placeholder="Was soll geändert werden? (Pflicht)" />
                <Button disabled={busy || !message.trim()} onClick={sendMarkup}><Send className="mr-1 h-4 w-4" /> {editingId ? "Speichern" : "Senden"}</Button>
              </div>
            )}
          </div>
          {/* Kommentare */}
          <div className="flex min-h-0 flex-1 flex-col border-l md:w-[360px] md:flex-none">
            <div className="flex gap-1 border-b p-2">
              {(["alle", "offen", "erledigt"] as const).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} className="h-7 px-2 text-xs capitalize" onClick={() => setFilter(f)}>{f}</Button>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {!tool && !draft.length && !comments.length && (
                <p className="p-2 text-sm text-muted-foreground">Noch keine Kommentare. Werkzeug wählen, auf die Datei zeichnen, Kommentar schreiben.</p>
              )}
              {withMarkup.map(renderComment)}
              {generalTops.length > 0 && <p className="px-1 pt-2 text-xs font-medium text-muted-foreground">Allgemein</p>}
              {generalTops.map(renderComment)}
              {fromOtherVersions.length > 0 && (
                <div className="pt-2">
                  <button className="w-full rounded px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted" onClick={() => setShowOther((v) => !v)}>
                    {showOther ? "▾" : "▸"} Aus anderen Versionen ({fromOtherVersions.length} offen)
                  </button>
                  {showOther && fromOtherVersions.map((c) => (
                    <button key={c.id} className="mt-1 block w-full rounded border p-2 text-left text-xs hover:bg-muted" onClick={() => switchToComment(c)}>
                      <span className="font-medium">v{versionOfPath(versions ?? undefined, c.media_ref?.storagePath)?.version} · {c.author_name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-muted-foreground">{c.message}</span>
                    </button>
                  ))}
                </div>
              )}
              {footer && <div className="border-t pt-2">{footer}</div>}
            </div>
            <div className="flex items-end gap-2 border-t p-2">
              <Textarea rows={2} value={general} onChange={(e) => setGeneral(e.target.value)} className="resize-none text-sm"
                placeholder="Allgemeiner Kommentar (ohne Markierung)…" />
              <Button size="icon" disabled={busy || !general.trim()} onClick={sendGeneral} title="Senden"><MessageSquare className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
