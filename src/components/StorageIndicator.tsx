import { useState, useEffect } from "react";
import { indexedDBStorage, formatBytes } from "@/lib/indexedDBStorage";
import { Progress } from "@/components/ui/progress";
import { HardDrive, AlertTriangle, CloudOff, RefreshCw, Cloud, AlertCircle } from "lucide-react";
import { SyncState, getSyncState, subscribeToSyncState } from "@/lib/syncStatus";

export const StorageIndicator = () => {
  const [storage, setStorage] = useState<{ used: number; quota: number; percentage: number } | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());

  useEffect(() => {
    const loadStorage = async () => setStorage(await indexedDBStorage.getStorageEstimate());
    loadStorage();
    return subscribeToSyncState(setSyncState);
  }, []);

  if (!storage || storage.quota === 0) return null;
  const isWarning = storage.percentage > 80;
  const SyncIcon = !syncState.isOnline ? CloudOff : syncState.isSyncing ? RefreshCw : syncState.lastError ? AlertCircle : Cloud;
  const syncText = !syncState.isOnline
    ? 'Offline – Änderungen werden nur lokal gespeichert'
    : syncState.isSyncing
      ? 'Synchronisiert gerade…'
      : syncState.lastError
        ? `Sync-Fehler: ${syncState.lastError}`
        : syncState.lastSyncedAt
          ? `Online gespeichert: ${new Date(syncState.lastSyncedAt).toLocaleString('de-DE')}`
          : 'Noch nicht mit der Cloud synchronisiert';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        {isWarning ? <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" /> : <HardDrive className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className={isWarning ? "text-destructive font-medium" : "text-muted-foreground"}>Speicher</span>
            <span className="text-muted-foreground">{formatBytes(storage.used)} / {formatBytes(storage.quota)}</span>
          </div>
          <Progress value={storage.percentage} className={`h-2 ${isWarning ? "[&>div]:bg-destructive" : ""}`} />
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg text-sm">
        <SyncIcon className={`h-5 w-5 flex-shrink-0 ${syncState.isSyncing ? 'animate-spin text-primary' : syncState.lastError ? 'text-destructive' : syncState.isOnline ? 'text-muted-foreground' : 'text-amber-600'}`} />
        <div className="min-w-0">
          <div className="font-medium">Sync-Status</div>
          <div className="text-muted-foreground break-words">{syncText}</div>
        </div>
      </div>
    </div>
  );
};
