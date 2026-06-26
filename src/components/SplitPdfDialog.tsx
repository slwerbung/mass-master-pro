import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileUp, Loader2, Scissors, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "@/integrations/supabase/client";
import { naturalLocationSortAsc } from "@/lib/locationSorting";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface LocationLite { id: string; locationNumber: string; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectNumber: string;
  locations: LocationLite[];
}

const IGNORE = "__ignore__";

/**
 * Splits a single multi-page PDF across the project's locations. Because the
 * Corel page names don't survive into the PDF, the dialog proposes an
 * assignment by page order (page 1 -> first location, ...) which the user can
 * adjust before confirming. Multiple pages may target the same location; those
 * pages are merged into that location's production PDF. Splitting + upload run
 * client-side (best done at a desktop for large files).
 */
export function SplitPdfDialog({ open, onOpenChange, projectId, projectNumber, locations }: Props) {
  const sortedLocations = [...locations].sort((a, b) => naturalLocationSortAsc(a.locationNumber, b.locationNumber));

  const fileRef = useRef<File | null>(null);
  const pdfDocRef = useRef<any>(null); // pdf.js document (for thumbnails)
  const [fileName, setFileName] = useState<string>("");
  const [pageCount, setPageCount] = useState(0);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [assignment, setAssignment] = useState<(string | null)[]>([]); // per page -> locationId | null
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset everything when the dialog closes.
  useEffect(() => {
    if (!open) {
      try { pdfDocRef.current?.destroy?.(); } catch { /* noop */ }
      pdfDocRef.current = null;
      fileRef.current = null;
      setFileName(""); setPageCount(0); setAssignment([]); setThumbs([]);
      setProcessing(false); setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [open]);

  const sizeLabel = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
  };

  const handleFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== "application/pdf") { toast.error("Bitte eine PDF-Datei auswählen."); return; }
    fileRef.current = f;
    setFileName(f.name);
    setLoadingDoc(true);
    try {
      const buf = await f.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      pdfDocRef.current = doc;
      const n = doc.numPages;
      setPageCount(n);
      setThumbs(new Array(n).fill(null));
      // Proposed assignment: page i -> location i (ascending). Extra pages
      // default to "ignore"; if there are fewer pages than locations, only the
      // first pages get assigned. The user can change anything below.
      const proposed: (string | null)[] = [];
      for (let i = 0; i < n; i++) proposed.push(sortedLocations[i]?.id ?? null);
      setAssignment(proposed);
    } catch (err: any) {
      toast.error("PDF konnte nicht gelesen werden: " + (err?.message || String(err)));
      fileRef.current = null; setFileName("");
    } finally {
      setLoadingDoc(false);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFile(e.target.files?.[0]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  // Lazily render a page thumbnail when its row scrolls into view.
  const renderThumb = async (pageIndex: number) => {
    if (thumbs[pageIndex] || !pdfDocRef.current) return;
    try {
      const page = await pdfDocRef.current.getPage(pageIndex + 1);
      const baseVp = page.getViewport({ scale: 1 });
      const scale = 120 / baseVp.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.7);
      setThumbs((prev) => { const next = [...prev]; next[pageIndex] = url; return next; });
    } catch { /* ignore a single bad page */ }
  };

  const assignedLocationIds = new Set(assignment.filter((x): x is string => !!x));
  const assignedCount = assignment.filter((x) => !!x).length;
  const ignoredCount = pageCount - assignedCount;
  const locationsWithPages = sortedLocations.filter((l) => assignedLocationIds.has(l.id)).length;
  const countMismatch = pageCount > 0 && pageCount !== sortedLocations.length;

  const setPageTarget = (pageIndex: number, value: string) => {
    setAssignment((prev) => {
      const next = [...prev];
      next[pageIndex] = value === IGNORE ? null : value;
      return next;
    });
  };

  const process = async () => {
    if (!fileRef.current) return;
    if (assignedCount === 0) { toast.error("Keine Seite ist einem Standort zugeordnet."); return; }

    // Group page indices per location, preserving page order.
    const byLocation = new Map<string, number[]>();
    assignment.forEach((locId, pageIdx) => {
      if (!locId) return;
      const arr = byLocation.get(locId) || [];
      arr.push(pageIdx);
      byLocation.set(locId, arr);
    });

    setProcessing(true);
    setProgress({ done: 0, total: byLocation.size });
    try {
      // Free the pdf.js document (and its copy of the bytes) before the heavy
      // split, then load the source once with pdf-lib.
      try { pdfDocRef.current?.destroy?.(); } catch { /* noop */ }
      pdfDocRef.current = null;

      const { PDFDocument } = await import("pdf-lib");
      const srcBytes = await fileRef.current.arrayBuffer();
      const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

      const locById = new Map(sortedLocations.map((l) => [l.id, l]));
      let done = 0;

      for (const [locId, pageIdxs] of byLocation) {
        const loc = locById.get(locId);
        // Build a PDF with just this location's pages, in order.
        const out = await PDFDocument.create();
        const copied = await out.copyPages(srcDoc, pageIdxs);
        copied.forEach((p) => out.addPage(p));
        const outBytes = await out.save({ useObjectStreams: true });
        const blob = new Blob([outBytes], { type: "application/pdf" });

        const path = `pdfs/${locId}/${Date.now()}_split.pdf`;
        // Replace any existing production PDF for this location (storage + row),
        // mirroring the single-upload behaviour.
        const { data: oldRows } = await supabase.from("location_pdfs").select("storage_path").eq("location_id", locId);
        const oldPaths = (oldRows || []).map((r: any) => r.storage_path).filter(Boolean);
        if (oldPaths.length > 0) {
          await supabase.storage.from("project-files").remove(oldPaths);
          await supabase.from("location_pdfs").delete().eq("location_id", locId);
        }
        const { error: upErr } = await supabase.storage.from("project-files").upload(path, blob, { contentType: "application/pdf" });
        if (upErr) throw new Error(`Standort ${loc?.locationNumber}: Upload fehlgeschlagen (${upErr.message})`);
        const fileLabel = `${loc?.locationNumber || "Standort"}.pdf`;
        const { error: dbErr } = await supabase.from("location_pdfs").insert({ location_id: locId, storage_path: path, file_name: fileLabel });
        if (dbErr) throw new Error(`Standort ${loc?.locationNumber}: Datenbankfehler (${dbErr.message})`);

        done += 1;
        setProgress({ done, total: byLocation.size });
      }

      toast.success(`Fertig: ${done} Standort(e) mit PDF versehen.`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Aufteilen fehlgeschlagen: " + (e?.message || String(e)));
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!processing) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" /> Produktionsdaten hochladen</DialogTitle>
        </DialogHeader>

        <input ref={inputRef} type="file" accept="application/pdf" onChange={onPick} className="hidden" />

        {!fileName ? (
          <div className="py-8">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">PDF mit Produktionsdaten hierher ziehen oder klicken</p>
              <p className="text-sm text-muted-foreground mt-1">Eine Datei mit allen Standort-Seiten – wird automatisch auf die Standorte verteilt</p>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Große Dateien werden im Browser verarbeitet – am besten am Desktop-Rechner.
            </p>
          </div>
        ) : loadingDoc ? (
          <div className="py-12 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" /> PDF wird gelesen …
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground shrink-0">
              <span className="font-medium text-foreground">{fileName}</span> · {pageCount} Seiten ·{" "}
              {sortedLocations.length} Standorte
              {fileRef.current && <> · {sizeLabel(fileRef.current.size)}</>}
            </div>

            {countMismatch && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-2 text-xs shrink-0">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Seitenzahl ({pageCount}) und Standortzahl ({sortedLocations.length}) stimmen nicht überein.
                  Der Vorschlag ordnet nach Reihenfolge zu – bitte prüfe die Zuordnung und korrigiere bei Bedarf
                  (mehrere Seiten pro Standort sind möglich).
                </span>
              </div>
            )}

            <div className="overflow-y-auto -mx-1 px-1 flex-1 space-y-2 min-h-0">
              {Array.from({ length: pageCount }).map((_, i) => (
                <PageRow
                  key={i}
                  index={i}
                  thumb={thumbs[i]}
                  onVisible={() => renderThumb(i)}
                  value={assignment[i] ?? IGNORE}
                  locations={sortedLocations}
                  onChange={(v) => setPageTarget(i, v)}
                />
              ))}
            </div>

            <div className="text-xs text-muted-foreground shrink-0">
              {locationsWithPages} Standort(e) erhalten ein PDF · {assignedCount} Seite(n) zugeordnet
              {ignoredCount > 0 && <> · {ignoredCount} ignoriert</>}
            </div>
          </>
        )}

        <DialogFooter className="shrink-0">
          {fileName && !loadingDoc && (
            <Button variant="ghost" onClick={() => { setFileName(""); fileRef.current = null; try { pdfDocRef.current?.destroy?.(); } catch { /* noop */ } pdfDocRef.current = null; setPageCount(0); setAssignment([]); setThumbs([]); }} disabled={processing}>
              Andere Datei
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>Abbrechen</Button>
          <Button onClick={process} disabled={processing || !fileName || loadingDoc || assignedCount === 0}>
            {processing
              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {progress ? `${progress.done}/${progress.total}` : "Verarbeite…"}</>
              : <><Scissors className="h-4 w-4 mr-1" /> Aufteilen &amp; hochladen</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageRow({ index, thumb, onVisible, value, locations, onChange }: {
  index: number;
  thumb: string | null;
  onVisible: () => void;
  value: string;
  locations: LocationLite[];
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { onVisible(); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className="flex items-center gap-3 rounded-md border p-2">
      <div className="w-[60px] h-[80px] bg-muted rounded overflow-hidden flex items-center justify-center shrink-0">
        {thumb
          ? <img src={thumb} alt={`Seite ${index + 1}`} className="max-w-full max-h-full object-contain" />
          : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="text-sm font-medium w-16 shrink-0">Seite {index + 1}</div>
      <select
        className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={IGNORE}>— ignorieren —</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>Standort {l.locationNumber}</option>
        ))}
      </select>
    </div>
  );
}
