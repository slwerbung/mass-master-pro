import { useState, useEffect } from "react";
import { indexedDBStorage, formatBytes } from "@/lib/indexedDBStorage";
import { Progress } from "@/components/ui/progress";
import { HardDrive, AlertTriangle } from "lucide-react";

export const StorageIndicator = () => {
  const [storage, setStorage] = useState<{ used: number; quota: number; percentage: number } | null>(null);

  useEffect(() => {
    const loadStorage = async () => {
      const estimate = await indexedDBStorage.getStorageEstimate();
      setStorage(estimate);
    };
    loadStorage();
  }, []);

  if (!storage || storage.quota === 0) return null;

  const isWarning = storage.percentage > 80;

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
      {isWarning ? (
        <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
      ) : (
        <HardDrive className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className={isWarning ? "text-destructive font-medium" : "text-muted-foreground"}>
            Speicher
          </span>
          <span className="text-muted-foreground">
            {formatBytes(storage.used)} / {formatBytes(storage.quota)}
          </span>
        </div>
        <Progress 
          value={storage.percentage} 
          className={`h-2 ${isWarning ? "[&>div]:bg-destructive" : ""}`}
        />
      </div>
    </div>
  );
};
