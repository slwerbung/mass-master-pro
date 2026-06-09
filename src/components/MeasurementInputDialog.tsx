import { useState, useEffect, useCallback, useRef } from "react";
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

// ── Leica DISTO / Würth WDM 3-19 BLE protocol ────────────────────────────
// The Würth WDM 3-19 is a rebadged Leica DISTO D2. Both expose the same
// custom GATT service. These constants are transport-agnostic: the same
// UUIDs and the same float decoding are reused later by the Capacitor
// native-BLE implementation for iOS.
//
//   Service          3ab10100-... (Leica custom)
//   Measurement      3ab10101-... 4-byte IEEE754 float, in the device's
//                                 configured unit (default: METERS),
//                                 properties read + indicate
//   Units            3ab10102-... 2 bytes, changes on each new measurement
//
// IMPORTANT: the device must be set to METERS (its default). The measurement
// float is delivered in whatever unit the device is configured to; we assume
// meters and convert to mm. The raw value is shown in the debug log so a
// wrong unit setting is immediately visible during testing.
const LEICA_SERVICE = "3ab10100-f831-4395-b29d-570977d5bf94";
const LEICA_MEASUREMENT_CHAR = "3ab10101-f831-4395-b29d-570977d5bf94";
const LEICA_UNITS_CHAR = "3ab10102-f831-4395-b29d-570977d5bf94";

// Standard SIG services, declared so we may optionally read battery/name.
const BATTERY_SERVICE = "battery_service"; // 0x180F
const DEVICE_INFO_SERVICE = "device_information"; // 0x180A

/**
 * Decode a Leica measurement characteristic value into millimetres.
 * The value is a 4-byte little-endian IEEE754 float in metres.
 * Returns null for error/sentinel values (out of range, NaN, <= 0).
 */
function decodeLeicaMeasurement(view: DataView): { mm: number; meters: number } | null {
  if (view.byteLength < 4) return null;
  const meters = view.getFloat32(0, /* littleEndian */ true);
  if (!Number.isFinite(meters)) return null;
  // Device range is 0.05–100 m. Anything outside is an error/sentinel
  // (e.g. the ~255 "too close" value seen on these devices).
  if (meters <= 0 || meters > 150) return null;
  return { mm: Math.round(meters * 1000), meters };
}

const MeasurementInputDialog = ({ open, onConfirm, onCancel }: MeasurementInputDialogProps) => {
  const [value, setValue] = useState("");
  const [btStatus, setBtStatus] = useState<"idle" | "connecting" | "connected" | "unsupported">("idle");
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!("bluetooth" in navigator)) {
      setBtStatus("unsupported");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setValue("");
      setDebugLog([]);
    }
  }, [open]);

  // Cleanup BT on unmount
  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const addDebug = useCallback((msg: string) => {
    setDebugLog(prev => [...prev.slice(-5), msg]);
  }, []);

  const handleBluetoothConnect = useCallback(async () => {
    if (!("bluetooth" in navigator)) {
      toast.error("Bluetooth wird in diesem Browser nicht unterstützt");
      return;
    }

    setBtStatus("connecting");
    setDebugLog([]);

    try {
      // acceptAllDevices because rebadged units (Würth) may advertise a
      // different name; optionalServices grants access to the Leica service
      // AFTER the user picks the device. Without this we cannot read any
      // characteristic – this was the core bug in the previous version.
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [LEICA_SERVICE, BATTERY_SERVICE, DEVICE_INFO_SERVICE],
      });

      addDebug(`Gerät: ${device.name || "Unbekannt"}`);

      device.addEventListener?.("gattserverdisconnected", () => {
        addDebug("Verbindung getrennt");
        setBtStatus("idle");
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT-Verbindung fehlgeschlagen");
      addDebug("GATT verbunden");

      // Get the Leica DISTO service directly.
      let service: any;
      try {
        service = await server.getPrimaryService(LEICA_SERVICE);
      } catch {
        addDebug("Leica-Service nicht gefunden");
        toast.error("Kein kompatibles Lasergerät (Leica/Würth) gefunden");
        try { device.gatt?.disconnect(); } catch { /* ignore */ }
        setBtStatus("idle");
        return;
      }

      const listeners: Array<{ char: any; handler: (e: Event) => void }> = [];

      const onMeasurement = (event: Event) => {
        const target = event.target as any;
        const view: DataView = target.value;
        const decoded = decodeLeicaMeasurement(view);
        // Always log the raw bytes so unit issues are visible while testing.
        const bytes = Array.from(new Uint8Array(view.buffer))
          .map(b => b.toString(16).padStart(2, "0")).join(" ");
        if (decoded) {
          addDebug(`Messung: ${decoded.meters.toFixed(3)} m → ${decoded.mm} mm`);
          setValue(decoded.mm.toString());
        } else {
          addDebug(`Roh (kein gültiger Wert): ${bytes}`);
        }
      };

      // Subscribe to the measurement characteristic (read + indicate).
      try {
        const measureChar = await service.getCharacteristic(LEICA_MEASUREMENT_CHAR);
        await measureChar.startNotifications(); // works for indicate too
        measureChar.addEventListener("characteristicvaluechanged", onMeasurement);
        listeners.push({ char: measureChar, handler: onMeasurement });
        addDebug("Messwert abonniert ✓");

        // Read the current value once (in case a measurement is already shown).
        try {
          const cur = await measureChar.readValue();
          const decoded = decodeLeicaMeasurement(cur);
          if (decoded) {
            addDebug(`Aktuell: ${decoded.meters.toFixed(3)} m`);
            setValue(decoded.mm.toString());
          }
        } catch { /* read-on-connect may be empty, ignore */ }
      } catch {
        addDebug("Messwert-Characteristic fehlt");
        toast.error("Messwert-Kanal nicht verfügbar");
        try { device.gatt?.disconnect(); } catch { /* ignore */ }
        setBtStatus("idle");
        return;
      }

      // Optionally observe the units characteristic for debugging unit codes.
      try {
        const unitsChar = await service.getCharacteristic(LEICA_UNITS_CHAR);
        const onUnits = (event: Event) => {
          const view: DataView = (event.target as any).value;
          const bytes = Array.from(new Uint8Array(view.buffer))
            .map(b => b.toString(16).padStart(2, "0")).join(" ");
          addDebug(`Einheiten-Code: ${bytes}`);
        };
        await unitsChar.startNotifications();
        unitsChar.addEventListener("characteristicvaluechanged", onUnits);
        listeners.push({ char: unitsChar, handler: onUnits });
      } catch { /* units char optional, ignore */ }

      cleanupRef.current = () => {
        for (const { char, handler } of listeners) {
          try {
            char.removeEventListener("characteristicvaluechanged", handler);
            char.stopNotifications();
          } catch { /* ignore */ }
        }
        try { device.gatt?.disconnect(); } catch { /* ignore */ }
      };

      setBtStatus("connected");
      toast.success("Laser verbunden – jetzt am Gerät messen");
    } catch (err: any) {
      console.error("Bluetooth error:", err);
      // NotFoundError = user cancelled the device picker, not a real error.
      if (err?.name !== "NotFoundError") {
        toast.error("Bluetooth-Verbindung fehlgeschlagen");
      }
      setBtStatus("idle");
    }
  }, [addDebug]);

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

          {btStatus !== "unsupported" ? (
            <div className="space-y-2">
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
