import { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bluetooth, BluetoothSearching } from "lucide-react";
import { useLaserMeasurement } from "@/lib/useLaserMeasurement";

interface AreaMeasurementDialogProps {
  open: boolean;
  onConfirm: (widthMm: number, heightMm: number) => void;
  onCancel: () => void;
}

const AreaMeasurementDialog = ({ open, onConfirm, onCancel }: AreaMeasurementDialogProps) => {
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  // Which field the next laser measurement fills. Starts on width and
  // auto-advances to height; the user can override by focusing a field.
  const [activeField, setActiveField] = useState<"width" | "height">("width");
  const activeFieldRef = useRef<"width" | "height">("width");
  activeFieldRef.current = activeField;

  const { status, debugLog, connect, supported } = useLaserMeasurement((mm) => {
    if (activeFieldRef.current === "width") {
      setWidth(mm.toString());
      setActiveField("height");
    } else {
      setHeight(mm.toString());
      setActiveField("width");
    }
  }, open);

  useEffect(() => {
    if (!open) { setWidth(""); setHeight(""); setActiveField("width"); }
  }, [open]);

  const handleSubmit = () => {
    const w = parseFloat(width);
    const h = parseFloat(height);
    if (w > 0 && h > 0) onConfirm(w, h);
  };

  const wNum = parseFloat(width);
  const hNum = parseFloat(height);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fläche bemaßen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="area-width">
              Breite in mm
              {status === "connected" && activeField === "width" && (
                <span className="ml-2 text-xs text-primary">← nächste Messung</span>
              )}
            </Label>
            <Input
              id="area-width" type="number" inputMode="decimal" placeholder="z.B. 2000"
              value={width}
              onFocusCapture={() => setActiveField("width")}
              onChange={(e) => setWidth(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("area-height")?.focus(); }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="area-height">
              Höhe in mm
              {status === "connected" && activeField === "height" && (
                <span className="ml-2 text-xs text-primary">← nächste Messung</span>
              )}
            </Label>
            <Input
              id="area-height" type="number" inputMode="decimal" placeholder="z.B. 1000"
              value={height}
              onFocusCapture={() => setActiveField("height")}
              onChange={(e) => setHeight(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>

          {width && height && wNum > 0 && hNum > 0 && (
            <p className="text-sm text-muted-foreground text-center">
              = {((wNum * hNum) / 1_000_000).toFixed(2)} m²
            </p>
          )}

          {supported && (
            <div className="space-y-2">
              <Button
                variant="outline" className="w-full"
                onClick={connect}
                disabled={status === "connecting"}
              >
                {status === "connecting" ? (
                  <><BluetoothSearching className="h-4 w-4 mr-2 animate-pulse" />Verbinde...</>
                ) : status === "connected" ? (
                  <><Bluetooth className="h-4 w-4 mr-2 text-primary" />Laser verbunden</>
                ) : (
                  <><Bluetooth className="h-4 w-4 mr-2" />Laser-Messgerät verbinden</>
                )}
              </Button>
              {status === "connected" && (
                <p className="text-xs text-muted-foreground text-center">
                  Messung füllt {activeField === "width" ? "Breite" : "Höhe"}, dann automatisch das andere Feld.
                </p>
              )}
              {debugLog.length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted rounded p-2 space-y-0.5 max-h-24 overflow-y-auto font-mono">
                  {debugLog.map((log, i) => (<div key={i}>{log}</div>))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
          <Button onClick={handleSubmit} disabled={!width.trim() || !height.trim()}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AreaMeasurementDialog;
