import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AreaMeasurementDialogProps {
  open: boolean;
  onConfirm: (widthMm: number, heightMm: number) => void;
  onCancel: () => void;
}

const AreaMeasurementDialog = ({ open, onConfirm, onCancel }: AreaMeasurementDialogProps) => {
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");

  useEffect(() => {
    if (!open) { setWidth(""); setHeight(""); }
  }, [open]);

  const handleSubmit = () => {
    const w = parseFloat(width);
    const h = parseFloat(height);
    if (w > 0 && h > 0) onConfirm(w, h);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fläche bemaßen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="area-width">Breite in mm</Label>
            <Input id="area-width" type="number" inputMode="decimal" placeholder="z.B. 2000"
              value={width} onChange={(e) => setWidth(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("area-height")?.focus(); }}
              autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="area-height">Höhe in mm</Label>
            <Input id="area-height" type="number" inputMode="decimal" placeholder="z.B. 1000"
              value={height} onChange={(e) => setHeight(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} />
          </div>
          {width && height && parseFloat(width) > 0 && parseFloat(height) > 0 && (
            <p className="text-sm text-muted-foreground text-center">
              = {((parseFloat(width) * parseFloat(height)) / 1_000_000).toFixed(2)} m²
            </p>
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
