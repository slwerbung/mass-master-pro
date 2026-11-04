/**
 * InAppCamera – Kamera im eigenen Fenster der App (getUserMedia).
 *
 * Warum: Mit <input capture> oeffnet Android die Kamera-App, unsere App
 * landet im Hintergrund – und Android beendet sie dort, sobald der
 * Arbeitsspeicher knapp wird. Feld-Diagnose (client_diagnostics, Okt. 2026):
 * viermal in zwei Minuten `stage = opened`, also waehrend die Kamera-App
 * offen war; das Foto ist dann weg, bevor die App es je sieht. Daran aendert
 * kein Sparen in der App etwas. Bleibt die Kamera IN der App, ist die App
 * im Vordergrund und wird nicht beendet.
 *
 * Die System-Kamera bleibt nur als Ausweg ("Handy-Kamera"), wenn diese
 * Kamera gar nicht startet (Freigabe fehlt, kein getUserMedia). Im normalen
 * Betrieb wird sie nicht mehr angeboten (Nov. 2026): Im Feld verlor sie das
 * Foto weiterhin ("Zu wenig Speicher fuer vorherige Operation").
 *
 * Weitwinkel (Nov. 2026): Browser liefern die Ultraweitwinkel-Kamera auf
 * zwei Wegen, je nach Geraet:
 *  - als Zoom unter 1x am selben Kamerabild (track capabilities.zoom.min
 *    kleiner als der Startwert, z. B. 0,5 – manche Android-Geraete, iPhone
 *    mit "Dual/Triple Camera") → Zoomknoepfe "0,5x / 1x / 2x";
 *  - als eigene Rueckkamera in enumerateDevices (iPhone "Ultraweitwinkel",
 *    Android mit mehreren "facing back") → Knopf "Kamera wechseln".
 * Die Wahl wird pro Geraet gemerkt (localStorage), damit Weitwinkel beim
 * naechsten Foto wieder da ist.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Zap, ZapOff, Smartphone, Loader2, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setInAppCameraOpen } from "@/lib/quietTime";

interface Props {
  open: boolean;
  /** Das aufgenommene Foto (JPEG). Die Kamera ist dann bereits aus. */
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Muss direkt aus dem Klick die System-Kamera oeffnen (input.click()). */
  onUseSystemCamera: () => void;
}

interface ZoomRange { min: number; max: number; step: number }
type CameraTrack = Omit<MediaStreamTrack, "getCapabilities" | "getSettings"> & {
  getCapabilities?: () => { torch?: boolean; zoom?: Partial<ZoomRange> };
  getSettings: () => MediaTrackSettings & { zoom?: number };
};

interface Lens { deviceId: string; label: string }

const LENS_KEY = "captfix_camera_lens";
const ZOOM_KEY = "captfix_camera_zoom";

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* nur Komfort */ }
}

const FRONT_RE = /front|vorder|user|selfie|facetime|facing front/i;
const BACK_RE = /back|rück|rueck|hinten|rear|environment|facing back/i;
const ULTRA_RE = /ultra|weitwinkel|wide|0[.,]5/i;
const TELE_RE = /tele/i;

/** Rueckkameras des Geraets. Labels gibt es erst nach der Kamera-Freigabe. */
async function listBackLenses(): Promise<Lens[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const video = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
    const back = video.filter((d) => BACK_RE.test(d.label) && !FRONT_RE.test(d.label));
    // Ohne Hinweis im Namen: alles ausser erkennbaren Frontkameras.
    const list = back.length > 0 ? back : video.filter((d) => !FRONT_RE.test(d.label));
    return list.map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

/**
 * Zweite Zeile unter "Kamera wechseln". Nur wo der Browser es verraet
 * (iPhone), steht dort "Weitwinkel"/"Tele"; Android nennt seine Kameras
 * "camera2 2, facing back" – dann ehrlich "2 von 3" statt zu raten.
 */
function lensName(lens: Lens, index: number, count: number): string {
  if (TELE_RE.test(lens.label)) return "Tele";
  // iPhone: "Rückseitige Ultraweitwinkelkamera" / "Back Ultra Wide Camera".
  // "Dual Wide"/"Triple" sind virtuelle Kameras mit Zoom – die heissen "Auto".
  if (/dual|triple|dreifach/i.test(lens.label)) return "Automatik";
  if (ULTRA_RE.test(lens.label)) return "Weitwinkel";
  return `${index + 1} von ${count}`;
}

function formatZoom(z: number): string {
  return `${(Math.round(z * 10) / 10).toString().replace(".", ",")}×`;
}

export function InAppCamera({ open, onCapture, onClose, onUseSystemCamera }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped on every stop: a getUserMedia that resolves after the camera was
  // closed (or restarted) must release its stream, or the camera stays on.
  const generationRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [lensId, setLensId] = useState<string | null>(null);
  /** Zoomstufen: Minimum (ggf. Weitwinkel), Normal (Startwert), ggf. 2× Normal. */
  const [zoomStops, setZoomStops] = useState<number[]>([]);
  const [zoomBase, setZoomBase] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);

  const stop = useCallback(() => {
    generationRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
    setTorchOn(false);
  }, []);

  const start = useCallback(async (deviceId?: string | null) => {
    setError(null);
    setReady(false);
    const generation = generationRef.current;
    const wanted = deviceId === undefined ? readPref(LENS_KEY) : deviceId;
    try {
      // 4:3 in hoher Aufloesung; das Geraet nimmt die naechstbeste. Der Editor
      // verkleinert ohnehin auf 2200 px (readImageFileForEditor).
      const size = { width: { ideal: 4032 }, height: { ideal: 3024 } };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: wanted
            ? { deviceId: { exact: wanted }, ...size }
            : { facingMode: { ideal: "environment" }, ...size },
        });
      } catch (err) {
        // Gemerktes Objektiv gibt es nicht mehr (andere Kennung nach
        // Browser-Update o. ae.): mit der Standard-Rueckkamera weiter.
        const name = (err as DOMException)?.name;
        if (!wanted || name === "NotAllowedError" || name === "SecurityError") throw err;
        writePref(LENS_KEY, null);
        if (generation !== generationRef.current) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, ...size },
        });
      }
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] as unknown as CameraTrack | undefined;
      const caps = track?.getCapabilities?.() ?? {};
      const settings = track?.getSettings?.();
      setTorchAvailable(!!caps.torch);
      setLensId(settings?.deviceId ?? null);

      // Zoom: nur anbieten, wenn das Geraet einen Bereich meldet.
      const zMin = caps.zoom?.min;
      const zMax = caps.zoom?.max;
      const zNow = settings?.zoom;
      if (track && typeof zMin === "number" && typeof zMax === "number" && zMax > zMin) {
        const base = typeof zNow === "number" && zNow >= zMin ? zNow : Math.max(1, zMin);
        const stops = [zMin];
        if (base - zMin > 0.05) stops.push(base);
        if (base * 2 <= zMax) stops.push(base * 2);
        setZoomBase(base);
        setZoomStops(stops.length > 1 ? stops : []);
        setZoom(base);
        // Gemerkte Zoomstufe (z. B. Weitwinkel) wieder einstellen.
        const saved = Number(readPref(ZOOM_KEY));
        if (stops.length > 1 && saved > 0 && saved >= zMin && saved <= zMax && Math.abs(saved - base) > 0.01) {
          try {
            await track.applyConstraints({ advanced: [{ zoom: saved } as MediaTrackConstraintSet] });
            if (generation !== generationRef.current) return;
            setZoom(saved);
          } catch { /* dann eben Normal */ }
        }
      } else {
        setZoomStops([]);
        setZoom(null);
      }

      // Objektive erst jetzt auflisten: vor der Freigabe fehlen die Namen.
      void listBackLenses().then((list) => {
        if (generation === generationRef.current) setLenses(list);
      });

      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      if (generation !== generationRef.current) return;
      setReady(true);
    } catch (err) {
      if (generation !== generationRef.current) return;
      const name = (err as DOMException)?.name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Die App darf die Kamera nicht benutzen. Bitte in den Browser-/App-Einstellungen die Kamera erlauben – oder die Handy-Kamera verwenden."
          : "Die Kamera konnte nicht gestartet werden. Bitte die Handy-Kamera verwenden.",
      );
      stop();
    }
  }, [stop]);

  useEffect(() => {
    if (!open) return;
    setInAppCameraOpen(true);
    void start();
    // Im Hintergrund gibt Android die Kamera ohnehin frei; beim Zurueckkehren
    // neu starten statt ein schwarzes Bild zu zeigen.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (!streamRef.current) void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      setInAppCameraOpen(false);
      setBusy(false);
      setError(null);
    };
  }, [open, start, stop]);

  const switchLens = () => {
    if (lenses.length < 2 || busy) return;
    const idx = lenses.findIndex((l) => l.deviceId === lensId);
    const next = lenses[(idx + 1) % lenses.length];
    writePref(LENS_KEY, next.deviceId);
    writePref(ZOOM_KEY, null);
    // Viele Geraete koennen nur eine Kamera gleichzeitig: erst alte aus.
    stop();
    void start(next.deviceId);
  };

  const applyZoom = async (value: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      setZoom(value);
      writePref(ZOOM_KEY, String(value));
    } catch { /* Geraet kann es doch nicht */ }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch { /* Geraet kann es doch nicht */ }
  };

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) { setBusy(false); return; }
    ctx.drawImage(video, 0, 0, w, h);
    // Kamera sofort aus: sie belegt selbst viel Speicher.
    stop();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) {
      setBusy(false);
      setError("Das Foto konnte nicht erstellt werden. Bitte noch einmal versuchen.");
      return;
    }
    onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }));
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" role="dialog" aria-label="Kamera">
      <div className="flex-1 relative min-h-0 flex items-center justify-center">
        <video ref={videoRef} playsInline muted autoPlay className="max-w-full max-h-full w-auto h-auto object-contain" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> {busy ? "Foto wird übernommen…" : "Kamera wird geöffnet…"}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-white/85 text-sm max-w-sm">{error}</p>
            <Button variant="secondary" onClick={onUseSystemCamera}>
              <Smartphone className="h-4 w-4 mr-2" /> Handy-Kamera verwenden
            </Button>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 left-3 rounded-full bg-black/50 text-white p-2.5"
          style={{ marginTop: "env(safe-area-inset-top)" }}
          aria-label="Schließen"
        >
          <X className="h-6 w-6" />
        </button>
        {torchAvailable && ready && (
          <button
            type="button"
            onClick={toggleTorch}
            className="absolute top-3 right-3 rounded-full bg-black/50 text-white p-2.5"
            style={{ marginTop: "env(safe-area-inset-top)" }}
            aria-label={torchOn ? "Licht aus" : "Licht an"}
          >
            {torchOn ? <Zap className="h-6 w-6 text-yellow-300" /> : <ZapOff className="h-6 w-6" />}
          </button>
        )}
      </div>
      {ready && zoomStops.length > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-2 pt-3">
          {zoomStops.map((z) => {
            const active = zoom != null && Math.abs(zoom - z) < 0.01;
            return (
              <button
                key={z}
                type="button"
                onClick={() => applyZoom(z)}
                className={`min-w-[52px] h-9 px-2 rounded-full text-sm font-medium ${active ? "bg-white text-black" : "bg-white/15 text-white"}`}
                aria-label={z < zoomBase - 0.01 ? "Weitwinkel" : `Zoom ${formatZoom(z / zoomBase)}`}
              >
                {formatZoom(z / zoomBase)}
              </button>
            );
          })}
        </div>
      )}
      <div className="shrink-0 flex items-center justify-between px-6 py-5 safe-area-bottom">
        <div className="w-20" />
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || busy}
          className="h-[72px] w-[72px] rounded-full border-4 border-white/80 bg-white disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="Foto aufnehmen"
        />
        {lenses.length > 1 ? (
          <button
            type="button"
            onClick={switchLens}
            disabled={busy}
            className="text-white text-xs flex flex-col items-center gap-1 w-20 leading-tight disabled:opacity-40"
            aria-label="Kamera wechseln"
          >
            <SwitchCamera className="h-6 w-6" />
            <span>Kamera wechseln</span>
            {(() => {
              const idx = lenses.findIndex((l) => l.deviceId === lensId);
              return idx >= 0 ? (
                <span className="text-white/60">{lensName(lenses[idx], idx, lenses.length)}</span>
              ) : null;
            })()}
          </button>
        ) : (
          <div className="w-20" />
        )}
      </div>
    </div>,
    document.body,
  );
}
