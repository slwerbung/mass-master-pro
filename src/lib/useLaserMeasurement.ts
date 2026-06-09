import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  connectLaser,
  getLaserState,
  laserSupported,
  setDebugSink,
  setMeasurementHandler,
  subscribeLaserState,
  tryRestoreLaser,
  type LaserState,
} from "@/lib/laserService";

export type LaserStatus = "idle" | "connecting" | "connected" | "unsupported";

function mapState(s: LaserState): LaserStatus {
  return s === "disconnected" ? "idle" : s;
}

/**
 * React glue around the singleton laserService.
 *
 * The connection lives in laserService and persists for the whole session
 * (and auto-reconnects after a sleep/drop), so this hook only mirrors the
 * shared connection state and routes measurements to the active dialog.
 *
 * @param onMeasurement called with each incoming measurement in millimetres
 * @param active        whether this dialog is currently open. Only the active
 *                      dialog receives measurements and shows debug output —
 *                      the PhotoEditor mounts both measurement dialogs at once.
 */
export function useLaserMeasurement(
  onMeasurement: (mm: number) => void,
  active: boolean
) {
  const supported = laserSupported();
  const [status, setStatus] = useState<LaserStatus>(() => mapState(getLaserState()));
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const handlerRef = useRef(onMeasurement);
  handlerRef.current = onMeasurement;

  const addDebug = useCallback(
    (msg: string) => setDebugLog((prev) => [...prev.slice(-5), msg]),
    []
  );

  // Mirror the shared connection state (incl. background auto-reconnects),
  // and try to restore a previous session's connection on first mount.
  useEffect(() => {
    const unsub = subscribeLaserState((s) => setStatus(mapState(s)));
    setStatus(mapState(getLaserState()));
    void tryRestoreLaser();
    return unsub;
  }, []);

  // Route measurements and debug output to this dialog only while it is open.
  useEffect(() => {
    if (!active) return;
    setMeasurementHandler((mm) => handlerRef.current?.(mm));
    setDebugSink(addDebug);
    return () => {
      setMeasurementHandler(null);
      setDebugSink(null);
    };
  }, [active, addDebug]);

  const connect = useCallback(async () => {
    setDebugLog([]);
    try {
      await connectLaser();
      toast.success("Laser verbunden – jetzt am Gerät messen");
    } catch (err: any) {
      if (err?.name === "NotFoundError") {
        // User cancelled the device picker — not an error.
      } else if (err?.message === "unsupported") {
        // No Web Bluetooth (e.g. iOS) — UI already shows the manual-entry note.
      } else if (err?.message === "no-service") {
        toast.error("Kein kompatibles Lasergerät (Leica/Würth) gefunden");
      } else {
        toast.error("Bluetooth-Verbindung fehlgeschlagen");
      }
    }
  }, []);

  return { status, debugLog, connect, supported };
}
