import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bluetooth, BluetoothSearching } from "lucide-react";
import { useLaserMeasurement } from "@/lib/useLaserMeasurement";

interface MeasurementInputDialogProps {
  open: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const MeasurementInputDialog = ({ open, onConfirm, onCancel }: MeasurementInputDialogProps) => {
  const [value, setValue] = useState("");
  const { status, debugLog, connect, supported } = useLaserMeasurement(
    (mm) => setValue(mm.toString()),
    open
  );

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const handleSubmit = () => {
    if (value.trim()) onConfirm(value.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Maß eingeben</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="measurement-value">Wert in mm</Label>
            <Input
              id="measurement-value"
              type="number"
              inputMode="decimal"
              placeholder="z.B. 1200"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
            />
          </div>

          {supported ? (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={connect}
                disabled={status === "connecting"}
              >
                {status === "connecting" ? (
                  <>
                    <BluetoothSearching className="h-4 w-4 mr-2 animate-pulse" />
                    Verbinde...
                  </>
                ) : status === "connected" ? (
                  <>
                    <Bluetooth className="h-4 w-4 mr-2 text-primary" />
                    Laser verbunden
                  </>
                ) : (
                  <>
                    <Bluetooth className="h-4 w-4 mr-2" />
                    Laser-Messgerät verbinden
                  </>
                )}
              </Button>

              {debugLog.length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted rounded p-2 space-y-0.5 max-h-28 overflow-y-auto font-mono">
                  {debugLog.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Bluetooth wird auf diesem Gerät/Browser nicht unterstützt
              (z.&nbsp;B. iPhone/iPad). Bitte den Wert manuell eingeben.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
          <Button onClick={handleSubmit} disabled={!value.trim()}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MeasurementInputDialog;
