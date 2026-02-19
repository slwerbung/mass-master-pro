import { useState, useEffect, useCallback } from "react";
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
import { toast } from "sonner";

interface MeasurementInputDialogProps {
  open: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const LASER_SERVICE_UUID = "00001101-0000-1000-8000-00805f9b34fb";
const LASER_CHAR_UUID = "00002101-0000-1000-8000-00805f9b34fb";

const MeasurementInputDialog = ({ open, onConfirm, onCancel }: MeasurementInputDialogProps) => {
  const [value, setValue] = useState("");
  const [btStatus, setBtStatus] = useState<"idle" | "connecting" | "connected" | "unsupported">("idle");
  const [btDevice, setBtDevice] = useState<any>(null);

  useEffect(() => {
    if (!("bluetooth" in navigator)) {
      setBtStatus("unsupported");
    }
  }, []);

  // Clean up on close
  useEffect(() => {
    if (!open) {
      setValue("");
    }
  }, [open]);

  const handleBluetoothConnect = useCallback(async () => {
    if (!("bluetooth" in navigator)) {
      toast.error("Bluetooth wird in diesem Browser nicht unterstützt");
      return;
    }

    setBtStatus("connecting");

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [LASER_SERVICE_UUID],
      });

      setBtDevice(device);

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("GATT-Verbindung fehlgeschlagen");
      }

      try {
        const service = await server.getPrimaryService(LASER_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(LASER_CHAR_UUID);

        await characteristic.startNotifications();
        characteristic.addEventListener("characteristicvaluechanged", (event: any) => {
          const decoder = new TextDecoder();
          const rawValue = decoder.decode(event.target.value);
          // Extract numeric value (e.g., "1.234" from "D: 1.234 m")
          const match = rawValue.match(/[\d]+[.,]?[\d]*/);
          if (match) {
            const numericValue = match[0].replace(",", ".");
            // Convert to mm if value seems to be in meters (< 100)
            const num = parseFloat(numericValue);
            const mmValue = num < 100 ? Math.round(num * 1000).toString() : Math.round(num).toString();
            setValue(mmValue);
          }
        });

        setBtStatus("connected");
        toast.success("Laser verbunden");
      } catch {
        // Device connected but service not found - still allow manual entry
        setBtStatus("connected");
        toast("Gerät verbunden – Messwerte können manuell übertragen werden");
      }
    } catch (err: any) {
      console.error("Bluetooth error:", err);
      if (err.name !== "NotFoundError") {
        toast.error("Bluetooth-Verbindung fehlgeschlagen");
      }
      setBtStatus("idle");
    }
  }, []);

  const handleSubmit = () => {
    if (value.trim()) {
      onConfirm(value.trim());
    }
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

          {btStatus !== "unsupported" && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleBluetoothConnect}
              disabled={btStatus === "connecting"}
            >
              {btStatus === "connecting" ? (
                <>
                  <BluetoothSearching className="h-4 w-4 mr-2 animate-pulse" />
                  Verbinde...
                </>
              ) : btStatus === "connected" ? (
                <>
                  <Bluetooth className="h-4 w-4 mr-2 text-primary" />
                  Laser verbunden – Wert empfangen
                </>
              ) : (
                <>
                  <Bluetooth className="h-4 w-4 mr-2" />
                  Laser-Messgerät verbinden
                </>
              )}
            </Button>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={!value.trim()}>
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MeasurementInputDialog;
