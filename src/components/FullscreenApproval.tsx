import { useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, CheckCircle2, Circle } from "lucide-react";
import { LocationApprovalMedia, ApprovalPdf } from "./LocationApprovalMedia";

export interface FsLocation {
  id: string;
  label: string;          // e.g. "Standort 001 · Eingang Süd"
  annotatedUrl?: string;
  pdfs: ApprovalPdf[];
  approved: boolean;
}

interface Props {
  locations: FsLocation[];
  index: number;
  setIndex: (i: number) => void;
  onToggleApprove: (id: string, approved: boolean) => void;
  onClose: () => void;
}

/**
 * Distraction-light fullscreen mode for fast approvals across many locations.
 * Big production-file viewer, minimal text, keyboard: ← → switch location,
 * Enter = approve & next, Esc = close.
 */
export function FullscreenApproval({ locations, index, setIndex, onToggleApprove, onClose }: Props) {
  const safeIndex = Math.min(Math.max(index, 0), locations.length - 1);
  const loc = locations[safeIndex];

  const nav = useCallback((d: number) => {
    setIndex((safeIndex + d + locations.length) % locations.length);
  }, [safeIndex, locations.length, setIndex]);

  const approveAndNext = useCallback(() => {
    if (!loc) return;
    if (!loc.approved) onToggleApprove(loc.id, true);
    nav(1);
  }, [loc, onToggleApprove, nav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nav(1);
      else if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "Enter") approveAndNext();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, approveAndNext, onClose]);

  if (!loc) return null;
  const approvedCount = locations.filter((l) => l.approved).length;

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900 text-white flex flex-col">
      {/* slim header */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm text-neutral-400 shrink-0">{safeIndex + 1} / {locations.length}</span>
          <span className="font-semibold truncate">{loc.label}</span>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${loc.approved ? "bg-green-500/20 text-green-300" : "bg-white/10 text-neutral-300"}`}>
            {loc.approved ? "Freigegeben" : "Offen"}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-neutral-400 hidden sm:inline">{approvedCount}/{locations.length} freigegeben</span>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg"><X className="h-5 w-5" /></button>
        </div>
      </div>

      {/* big viewer */}
      <div className="flex-1 px-3 sm:px-6 pb-2 min-h-0">
        <LocationApprovalMedia
          key={loc.id}
          annotatedUrl={loc.annotatedUrl}
          pdfs={loc.pdfs}
          heightClass="h-full"
          big
        />
      </div>

      {/* controls */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-4">
        <button onClick={() => nav(-1)} className="flex items-center gap-1 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20">
          <ChevronLeft className="h-5 w-5" /> <span className="hidden sm:inline">Zurück</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleApprove(loc.id, !loc.approved)}
            className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20"
          >
            {loc.approved ? <Circle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            <span className="hidden sm:inline">{loc.approved ? "Zurücknehmen" : "Freigeben"}</span>
          </button>
          <button onClick={approveAndNext} className="flex items-center gap-2 px-5 sm:px-6 py-3 rounded-lg bg-green-600 hover:bg-green-700 font-semibold">
            <CheckCircle2 className="h-5 w-5" /> Freigeben &amp; weiter
          </button>
        </div>
        <button onClick={() => nav(1)} className="flex items-center gap-1 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20">
          <span className="hidden sm:inline">Weiter</span> <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="text-center text-[11px] text-neutral-500 pb-2 hidden sm:block">
        Tastatur: ← → wechseln · Enter = Freigeben &amp; weiter · Esc = schließen
      </div>
    </div>
  );
}
