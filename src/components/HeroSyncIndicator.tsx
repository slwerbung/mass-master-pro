import { useState, useEffect } from "react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Small status tile showing how many HERO uploads are pending in the
 * background queue. Hidden when the queue is empty so it doesn't clutter
 * the UI during normal operation. Placed alongside StorageIndicator on
 * the Projects page.
 *
 * Polls the queue every 3 seconds. That's cheap (one IndexedDB read) and
 * gives a "mostly live" feel without tying into the worker's internals.
 */
export const HeroSyncIndicator = () => {
  const [counts, setCounts] = useState<{ total: number; failed: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const c = await indexedDBStorage.countPendingHeroUploads();
        if (!cancelled) setCounts(c);
      } catch {
        // ignore - queue reads failing isn't worth surfacing to the user
      }
    };
    poll();
    const interval = window.setInterval(poll, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!counts || counts.total === 0) return null;

  // Split into "working on it" vs "stuck" visuals - a failed upload
  // needs attention, a pending one doesn't.
  const pendingActive = counts.total - counts.failed;
  const hasFailures = counts.failed > 0;

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
        <div className="flex items-center gap-3 p-3 bg-destructive/10 rounded-lg text-sm">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="font-medium text-destructive">HERO-Upload fehlgeschlagen</div>
            <div className="text-muted-foreground">
              {counts.failed} {counts.failed === 1 ? "Datei konnte" : "Dateien konnten"} nicht zu HERO übertragen werden.
              Bitte manuell hochladen.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
