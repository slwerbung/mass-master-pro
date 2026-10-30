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
 * Die System-Kamera bleibt als Ausweg ("Handy-Kamera"), falls die
 * Kamera-Freigabe fehlt oder das Geraet getUserMedia nicht kann.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Zap, ZapOff, Smartphone, Loader2 } from "lucide-react";
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

type TorchTrack = Omit<MediaStreamTrack, "getCapabilities"> & { getCapabilities?: () => { torch?: boolean } };

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

  const stop = useCallback(() => {
    generationRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
    setTorchOn(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setReady(false);
    const generation = generationRef.current;
    try {
      // 4:3 in hoher Aufloesung; das Geraet nimmt die naechstbeste. Der Editor
      // verkleinert ohnehin auf 2200 px (readImageFileForEditor).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] as TorchTrack | undefined;
      setTorchAvailable(!!track?.getCapabilities?.().torch);
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
      <div className="shrink-0 flex items-center justify-between px-6 py-5 safe-area-bottom">
        <button type="button" onClick={onUseSystemCamera} className="text-white/70 text-xs flex flex-col items-center gap-1 w-16">
          <Smartphone className="h-5 w-5" />
          Handy-Kamera
        </button>
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || busy}
          className="h-[72px] w-[72px] rounded-full border-4 border-white/80 bg-white disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="Foto aufnehmen"
        />
        <div className="w-16" />
      </div>
    </div>,
    document.body,
  );
}
