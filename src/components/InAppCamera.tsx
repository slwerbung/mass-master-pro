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
 *
 * Querformat (Nov. 2026): Gedreht lag das Vorschaubild als kleines Feld in
 * der Mitte, Zoom und Ausloeser darunter. Jetzt fuellt die Vorschau die ganze
 * Hoehe, alle Knoepfe stehen in einer Leiste rechts (wie bei der
 * Kamera-App des Handys).
 *
 * Volle Fotoqualitaet (Nov. 2026): Wo der Browser ImageCapture kennt
 * (Chrome/Android), nimmt takePhoto() ein echtes Foto mit Autofokus und
 * Belichtung des Sensors auf – bis ca. 4000 px lange Seite (Speicher!).
 * Fehlt ImageCapture (iPhone/Safari), scheitert es oder dauert es laenger
 * als 5 s, wird wie bisher ein Standbild aus dem Videobild genommen.
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

/** Laengste Seite eines Fotos aus takePhoto(): genug fuer Aufmass, schont den Speicher. */
const MAX_PHOTO_SIDE = 4000;
const TAKE_PHOTO_TIMEOUT_MS = 5000;

function useLandscape(): boolean {
  const query = "(orientation: landscape)";
  const [landscape, setLandscape] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setLandscape(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return landscape;
}

interface JpegInfo { width: number; height: number; orientation: number }

/**
 * Liest nur den Kopf einer JPEG-Datei (SOF-Groesse + EXIF-Orientation),
 * ohne das Bild zu dekodieren. null = kein lesbares JPEG.
 */
async function readJpegInfo(blob: Blob): Promise<JpegInfo | null> {
  try {
    const buf = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return null;
    let orientation = 1;
    let off = 2;
    while (off + 4 <= buf.byteLength) {
      if (buf.getUint8(off) !== 0xff) return null;
      const marker = buf.getUint8(off + 1);
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { off += 2; continue; }
      const len = buf.getUint16(off + 2);
      if (marker === 0xe1 && off + 10 <= buf.byteLength && buf.getUint32(off + 4) === 0x45786966) {
        orientation = readExifOrientation(buf, off + 10, Math.min(buf.byteLength, off + 2 + len)) ?? orientation;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof && off + 9 <= buf.byteLength) {
        return { height: buf.getUint16(off + 5), width: buf.getUint16(off + 7), orientation };
      }
      off += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function readExifOrientation(buf: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const little = buf.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => buf.getUint16(o, little);
  const u32 = (o: number) => buf.getUint32(o, little);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Bildgroesse fuer takePhoto: groesste Stufe bis MAX_PHOTO_SIDE (lange Seite). */
function pickPhotoSize(
  caps: { imageWidth?: { min?: number; max?: number; step?: number }; imageHeight?: { min?: number; max?: number } } | undefined,
): { imageWidth?: number; imageHeight?: number } {
  const wMax = caps?.imageWidth?.max;
  const hMax = caps?.imageHeight?.max;
  if (!wMax || !hMax) return {};
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(wMax, hMax));
  if (scale >= 1) return { imageWidth: wMax, imageHeight: hMax };
  const step = caps?.imageWidth?.step || 1;
  const wMin = caps?.imageWidth?.min || 1;
  const w = Math.max(wMin, Math.floor((wMax * scale) / step) * step);
  return { imageWidth: w, imageHeight: Math.round((w * hMax) / wMax) };
}

/**
 * Richtet ein takePhoto()-Ergebnis wie die Vorschau aus. Hintergrund: Einige
 * Android-/Chrome-Versionen liefern das Foto in Sensor-Ausrichtung (meist
 * quer) ohne EXIF-Drehung, obwohl das Handy hochkant gehalten wird. Passt
 * Hoch/Quer zur Vorschau oder erklaert ein EXIF-Tag den Unterschied, bleibt
 * die Datei unveraendert. Verkleinern muss hier niemand: der Editor liest
 * jedes Foto ohnehin speicherschonend auf Zielgroesse ein
 * (readImageFileForEditor); beim Drehen wird trotzdem gleich auf
 * MAX_PHOTO_SIDE dekodiert.
 */
async function normalizePhoto(blob: Blob, previewLandscape: boolean): Promise<Blob> {
  const info = await readJpegInfo(blob);
  if (!info || info.orientation !== 1 || info.width === info.height) return blob;
  if ((info.width > info.height) === previewLandscape) return blob;
  if (typeof createImageBitmap !== "function") return blob;

  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(info.width, info.height));
  let bmp: ImageBitmap | null = null;
  const canvas = document.createElement("canvas");
  try {
    bmp = await createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(info.width * scale)),
      resizeHeight: Math.max(1, Math.round(info.height * scale)),
      resizeQuality: "high",
    });
    // Drehrichtung: Rueckkameras sind fast immer mit 90° Sensor-Ausrichtung
    // verbaut. Noetige Drehung = (Sensor 90° − Bildschirmwinkel): hochkant
    // (0°) also 90° im Uhrzeigersinn, auf dem Kopf (180°) 270°. Ergibt die
    // Formel 0/180, obwohl Hoch/Quer nicht passt, ist der Sensor anders
    // verbaut – dann bestmoeglich 90°.
    const angle = (typeof screen !== "undefined" && screen.orientation?.angle) || 0;
    let deg = (((90 - angle) % 360) + 360) % 360;
    if (deg === 0 || deg === 180) deg = 90;
    canvas.width = bmp.height;
    canvas.height = bmp.width;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return blob;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    bmp.close();
    bmp = null;
    return (await canvasToJpeg(canvas)) ?? blob;
  } catch {
    return blob;
  } finally {
    bmp?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

type ImageCaptureLike = {
  takePhoto: (settings?: Record<string, unknown>) => Promise<Blob>;
  getPhotoCapabilities?: () => Promise<{
    imageWidth?: { min?: number; max?: number; step?: number };
    imageHeight?: { min?: number; max?: number };
    fillLightMode?: string[];
  }>;
};

/** Echtes Foto ueber ImageCapture (Chrome/Android). null = nicht verfuegbar/fehlgeschlagen. */
async function takeFullPhoto(track: MediaStreamTrack, torchOn: boolean): Promise<Blob | null> {
  const Ctor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (!Ctor || track.readyState !== "live") return null;
  try {
    const capture = new Ctor(track);
    const run = async () => {
      const caps = await capture.getPhotoCapabilities?.().catch(() => undefined);
      const settings: Record<string, unknown> = { ...pickPhotoSize(caps) };
      const modes = caps?.fillLightMode || [];
      // Licht nur, wenn die Taschenlampe an ist; sonst ausdruecklich aus,
      // damit kein ungefragter Blitz ausloest.
      if (torchOn && modes.includes("flash")) settings.fillLightMode = "flash";
      else if (!torchOn && modes.includes("off")) settings.fillLightMode = "off";
      return capture.takePhoto(settings);
    };
    const blob = await withTimeout(run(), TAKE_PHOTO_TIMEOUT_MS);
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
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
  const landscape = useLandscape();

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

  const grabFrame = async (video: HTMLVideoElement): Promise<Blob | null> => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await canvasToJpeg(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  };

  const shoot = async () => {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track || !ready || busy) return;
    setBusy(true);
    const generation = generationRef.current;
    const previewLandscape = video.videoWidth > video.videoHeight;

    // 1. Echtes Foto (volle Sensorqualitaet), solange die Kamera noch laeuft.
    let blob = await takeFullPhoto(track as MediaStreamTrack, torchOn);
    // Geschlossen/Hintergrund waehrend der Aufnahme: nichts mehr tun.
    if (generation !== generationRef.current) { setBusy(false); return; }
    // 2. Sonst Standbild aus dem Videobild (iPhone, aeltere Browser, Fehler).
    if (!blob) blob = await grabFrame(video);
    // Kamera erst jetzt aus: takePhoto braucht den laufenden Track. Sie
    // belegt selbst viel Speicher, darum vor dem Weiterverarbeiten.
    stop();
    if (blob) blob = await normalizePhoto(blob, previewLandscape);
    if (!blob) {
      setBusy(false);
      setError("Das Foto konnte nicht erstellt werden. Bitte noch einmal versuchen.");
      return;
    }
    onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }));
  };

  if (!open) return null;

  const activeLensIdx = lenses.findIndex((l) => l.deviceId === lensId);

  const zoomButtons = ready && zoomStops.length > 1
    ? zoomStops.map((z) => {
        const active = zoom != null && Math.abs(zoom - z) < 0.01;
        return (
          <button
            key={z}
            type="button"
            onClick={() => applyZoom(z)}
            disabled={busy}
            className={`min-w-[52px] h-9 px-2 rounded-full text-sm font-medium ${active ? "bg-white text-black" : "bg-white/15 text-white"}`}
            aria-label={z < zoomBase - 0.01 ? "Weitwinkel" : `Zoom ${formatZoom(z / zoomBase)}`}
          >
            {formatZoom(z / zoomBase)}
          </button>
        );
      })
    : null;

  const shutter = (
    <button
      type="button"
      onClick={shoot}
      disabled={!ready || busy}
      className="h-[72px] w-[72px] shrink-0 rounded-full border-4 border-white/80 bg-white disabled:opacity-40 active:scale-95 transition-transform"
      aria-label="Foto aufnehmen"
    />
  );

  const lensButton = lenses.length > 1 ? (
    <button
      type="button"
      onClick={switchLens}
      disabled={busy}
      className="text-white text-xs flex flex-col items-center gap-1 w-20 leading-tight disabled:opacity-40"
      aria-label="Kamera wechseln"
    >
      <SwitchCamera className="h-6 w-6" />
      <span>Kamera wechseln</span>
      {activeLensIdx >= 0 && (
        <span className="text-white/60">{lensName(lenses[activeLensIdx], activeLensIdx, lenses.length)}</span>
      )}
    </button>
  ) : (
    <div className="w-20" />
  );

  const preview = (
    <div
      className="flex-1 relative min-h-0 min-w-0"
      style={landscape ? { paddingLeft: "env(safe-area-inset-left)" } : undefined}
    >
      {/* Fuellt die ganze Flaeche; object-contain = was man sieht, wird fotografiert. */}
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-contain" />
      {(!ready || busy) && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-white/80 gap-2 bg-black/30">
          <Loader2 className="h-5 w-5 animate-spin" />
          {busy ? (ready ? "Foto wird aufgenommen…" : "Foto wird übernommen…") : "Kamera wird geöffnet…"}
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
        style={{ marginTop: "env(safe-area-inset-top)", marginLeft: landscape ? "env(safe-area-inset-left)" : undefined }}
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
  );

  return createPortal(
    landscape ? (
      // Querformat: Vorschau ueber die volle Hoehe, Knoepfe als Leiste rechts.
      <div className="fixed inset-0 z-[100] bg-black flex flex-row" role="dialog" aria-label="Kamera">
        {preview}
        <div
          className="shrink-0 w-28 grid grid-rows-[1fr_auto_1fr] justify-items-center py-3"
          style={{
            paddingRight: "env(safe-area-inset-right)",
            boxSizing: "content-box",
            paddingTop: "max(0.75rem, env(safe-area-inset-top))",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <div className="self-end flex flex-col-reverse items-center gap-2 pb-5">{zoomButtons}</div>
          {shutter}
          <div className="self-start pt-5">{lensButton}</div>
        </div>
      </div>
    ) : (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col" role="dialog" aria-label="Kamera">
        {preview}
        {zoomButtons && (
          <div className="shrink-0 flex items-center justify-center gap-2 pt-3">{zoomButtons}</div>
        )}
        <div className="shrink-0 flex items-center justify-between px-6 py-5 safe-area-bottom">
          <div className="w-20" />
          {shutter}
          {lensButton}
        </div>
      </div>
    ),
    document.body,
  );
}
