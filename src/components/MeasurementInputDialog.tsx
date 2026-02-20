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

/** Try to extract a mm value from raw laser data */
function parseLaserValue(raw: string): string | null {
  // Try patterns like "D: 1.234 m", "1.234m", "1234mm", "1234", "1.234"
  const trimmed = raw.trim();

  // mm pattern: "1234mm" or "1234 mm"
  const mmMatch = trimmed.match(/([\d]+[.,]?[\d]*)\s*mm/i);
  if (mmMatch) {
    return Math.round(parseFloat(mmMatch[1].replace(",", "."))).toString();
  }

  // m pattern: "1.234m" or "D: 1.234 m"
  const mMatch = trimmed.match(/([\d]+[.,][\d]+)\s*m(?!m)/i);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1].replace(",", ".")) * 1000).toString();
  }

  // cm pattern
  const cmMatch = trimmed.match(/([\d]+[.,]?[\d]*)\s*cm/i);
  if (cmMatch) {
    return Math.round(parseFloat(cmMatch[1].replace(",", ".")) * 10).toString();
  }

  // Plain number – guess unit by magnitude
  const numMatch = trimmed.match(/([\d]+[.,]?[\d]*)/);
  if (numMatch) {
    const num = parseFloat(numMatch[1].replace(",", "."));
    if (num > 0 && num < 100) {
      // Likely meters
      return Math.round(num * 1000).toString();
    }
    if (num >= 100) {
      // Likely mm already
      return Math.round(num).toString();
    }
  }

  return null;
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
    setDebugLog(prev => [...prev.slice(-4), msg]);
  }, []);

  const handleBluetoothConnect = useCallback(async () => {
    if (!("bluetooth" in navigator)) {
      toast.error("Bluetooth wird in diesem Browser nicht unterstützt");
      return;
    }

    setBtStatus("connecting");
    setDebugLog([]);

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [], // We'll discover services dynamically
      });

      addDebug(`Gerät: ${device.name || "Unbekannt"}`);

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("GATT-Verbindung fehlgeschlagen");
      }

      addDebug("GATT verbunden, suche Services...");

      // Discover all available services
      let services: any[] = [];
      try {
        services = await server.getPrimaryServices();
      } catch (e) {
        addDebug("Keine Services gefunden");
        setBtStatus("connected");
        toast("Gerät verbunden – keine BLE-Services gefunden. Manuelle Eingabe möglich.");
        return;
      }

      addDebug(`${services.length} Service(s) gefunden`);

      const listeners: Array<{ char: any; handler: (e: Event) => void }> = [];

      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            // Subscribe to notifications
            if (char.properties.notify || char.properties.indicate) {
              try {
                await char.startNotifications();
                const handler = (event: Event) => {
                  const target = event.target as any;
                  const decoder = new TextDecoder();
                  const rawValue = decoder.decode(target.value!);
                  addDebug(`Empfangen: "${rawValue}"`);
                  const parsed = parseLaserValue(rawValue);
                  if (parsed) {
                    setValue(parsed);
                  }
                };
                char.addEventListener("characteristicvaluechanged", handler);
                listeners.push({ char, handler });
                addDebug(`Notify auf ${char.uuid.slice(0, 8)}...`);
              } catch {
                // Ignore characteristics that fail to subscribe
              }
            }

            // Try reading current value
            if (char.properties.read) {
              try {
                const val = await char.readValue();
                const decoder = new TextDecoder();
                const rawValue = decoder.decode(val);
                if (rawValue.trim()) {
                  addDebug(`Gelesen: "${rawValue}"`);
                  const parsed = parseLaserValue(rawValue);
                  if (parsed) {
                    setValue(parsed);
                  }
                }
              } catch {
                // Ignore read errors
              }
            }
          }
        } catch {
          // Ignore service enumeration errors
        }
      }

      // Cleanup function
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
      toast.success("Laser verbunden");
    } catch (err: any) {
      console.error("Bluetooth error:", err);
      if (err.name !== "NotFoundError") {
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

          {btStatus !== "unsupported" && (
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
                <div className="text-xs text-muted-foreground bg-muted rounded p-2 space-y-0.5 max-h-24 overflow-y-auto font-mono">
                  {debugLog.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                </div>
              )}
            </div>
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
