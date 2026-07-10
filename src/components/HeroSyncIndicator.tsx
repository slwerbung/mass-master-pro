import { useState, useEffect, useCallback } from "react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { pokeHeroUploadWorker } from "@/lib/heroUploadWorker";
import { Upload, AlertCircle, X, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

/**
 * Small status tile showing how many HERO uploads are pending in the
 * background queue. Hidden when the queue is empty so it doesn't clutter
 * the UI during normal operation. Placed alongside StorageIndicator on
 * the Projects page.
 *
 * Polls the queue every 3 seconds. That's cheap (one IndexedDB read) and
 * gives a "mostly live" feel without tying into the worker's internals.
 * When there are failures it also loads their per-file reason so the user
 * can see WHY an upload failed and retry it, rather than only "upload
 * manually".
 */

// Friendly labels for the internal upload-type keys.
const TYPE_LABELS: Record<string, string> = {
  location_image: "Standortbild",
  location_image_original: "Standortbild (Original)",
  detail_image: "Detailbild",
  detail_image_original: "Detailbild (Original)",
  aufmass_pdf: "Aufmaß-PDF",
  lager_label_pdf: "Lager-Etikett",
  vehicle_image: "Fahrzeugbild",
  vehicle_layout: "Layout",
  vehicle_measured_image: "Bemaßtes Fahrzeugbild",
  vehicle_measured_image_original: "Fahrzeugbild (Original)",
};

interface FailedItem {
  id: string;
  filename: string;
  uploadType: string;
  projectId: string;
  lastError: string | null;
}

export const HeroSyncIndicator = () => {
  const [counts, setCounts] = useState<{ total: number; failed: number } | null>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = await indexedDBStorage.countPendingHeroUploads();
      setCounts(c);
      if (c.failed > 0) {
        setFailedItems(await indexedDBStorage.getFailedHeroUploads());
      } else {
        setFailedItems([]);
      }
    } catch {
      // ignore - queue reads failing isn't worth surfacing to the user
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const c = await indexedDBStorage.countPendingHeroUploads();
        if (cancelled) return;
        setCounts(c);
        if (c.failed > 0) {
          const items = await indexedDBStorage.getFailedHeroUploads();
          if (!cancelled) setFailedItems(items);
        } else if (!cancelled) {
          setFailedItems([]);
        }
      } catch {
        // ignore
      }
    };
    poll();
    const interval = window.setInterval(poll, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const dismissFailed = async () => {
    try {
      const n = await indexedDBStorage.dismissFailedHeroUploads();
      toast.success(n === 1 ? "1 Eintrag verworfen" : `${n} Einträge verworfen`);
      refresh();
    } catch {
      toast.error("Verwerfen fehlgeschlagen");
    }
  };

  const retryFailed = async () => {
    setRetrying(true);
    try {
      const n = await indexedDBStorage.retryFailedHeroUploads();
      pokeHeroUploadWorker();
      toast.success(n === 1 ? "1 Upload wird erneut versucht" : `${n} Uploads werden erneut versucht`);
      refresh();
    } catch {
      toast.error("Erneuter Versuch fehlgeschlagen");
    } finally {
      setRetrying(false);
    }
  };

  if (!counts || counts.total === 0) return null;

  // Split into "working on it" vs "stuck" visuals - a failed upload
  // needs attention, a pending one doesn't.
  const pendingActive = counts.total - counts.failed;
  const hasFailures = counts.failed > 0;

  // Show the single most common reason as a headline (the details list has
  // the per-file breakdown). Most failures share the same root cause.
  const topReason = failedItems.find((i) => i.lastError)?.lastError || null;

  return (
    <div className="space-y-2">
      {pendingActive > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg text-sm">
          <Upload className="h-5 w-5 flex-shrink-0 text-primary animate-pulse" />
          <div className="min-w-0">
            <div className="font-medium">HERO-Upload</div>
            <div className="text-muted-foreground">
              {pendingActive} {pendingActive === 1 ? "Datei wird" : "Dateien werden"} übertragen…
            </div>
          </div>
        </div>
      )}
      {hasFailures && (
        <div className="p-3 bg-destructive/10 rounded-lg text-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-destructive mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-destructive">HERO-Upload fehlgeschlagen</div>
              <div className="text-muted-foreground">
                {counts.failed} {counts.failed === 1 ? "Datei konnte" : "Dateien konnten"} nicht zu HERO übertragen werden.
              </div>
              {topReason && (
                <div className="text-muted-foreground mt-0.5 break-words">
                  <span className="font-medium">Grund:</span> {topReason}
                </div>
              )}
              <div className="flex items-center gap-3 mt-2">
                <button
                  type="button"
                  onClick={retryFailed}
                  disabled={retrying}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} /> Erneut versuchen
                </button>
                {failedItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {showDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Details
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={dismissFailed}
              title="Fehlermeldung verwerfen"
              className="flex-shrink-0 p-1 -m-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {showDetails && failedItems.length > 0 && (
            <ul className="mt-2 pl-8 space-y-1.5">
              {failedItems.map((it) => (
                <li key={it.id} className="text-xs">
                  <span className="font-medium">{TYPE_LABELS[it.uploadType] || it.uploadType}</span>
                  <span className="text-muted-foreground"> · {it.filename}</span>
                  {it.lastError && <div className="text-muted-foreground/90 break-words">{it.lastError}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
