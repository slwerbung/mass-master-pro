// Tracks a native-camera round trip step by step, so a restart can be told
// apart:
//
//   opened   → camera app is open (we are in the background)
//   returned → we are visible again (the page survived the camera)
//   file     → the photo arrived (size/type recorded)
//   dims     → photo dimensions read
//   scaled   → photo downscaled for the editor
//   editor   → editor is building the canvas
//   (done)   → editor shows the photo → marker removed
//
// If the app starts while a fresh marker is still there, it was restarted in
// between. The last stage says where:
//   - "opened": Android ended the app while the camera was open. The photo is
//     lost before the app ever sees it – nothing the web app can do.
//   - "returned" or later: the app died AFTER coming back (while handling the
//     photo) – that is ours to fix.
// Staff devices also report it to public.client_diagnostics.
//
// Upload-only flows (vehicle photos, customer uploads) don't go through the
// editor; for them the round trip counts as done once the file arrived.

const KEY = "camera-pending";
const MAX_AGE_MS = 10 * 60 * 1000;
// A crash while handling the photo happens within seconds. If the page is
// still alive this long after the file arrived, the marker was just left over
// (e.g. the user backed out of the editor) and must not cause a false alarm.
const ALIVE_AFTER_FILE_MS = 30 * 1000;

export type CameraStage = "opened" | "returned" | "file" | "dims" | "scaled" | "editor";
type Flow = "editor" | "upload";

export interface CameraPending {
  path: string;
  at: number;
  flow: Flow;
  stage: CameraStage;
  stageAt: number;
  info: Record<string, unknown>;
}

let listenersInstalled = false;
let aliveTimer: number | undefined;

function read(): CameraPending | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CameraPending) : null;
  } catch {
    return null;
  }
}

function write(p: CameraPending) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function clear() {
  window.clearTimeout(aliveTimer);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Record progress of the current camera round trip (no-op without one). */
export function cameraStage(stage: CameraStage, info: Record<string, unknown> = {}) {
  const p = read();
  if (!p) return;
  write({ ...p, stage, stageAt: Date.now(), info: { ...p.info, ...info } });
}

/** The photo is in the editor – the round trip succeeded. */
export function cameraFinished() {
  clear();
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const p = read();
    if (p && p.stage === "opened") cameraStage("returned", { returnedAfterMs: Date.now() - p.at });
  });
  const onFileInput = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (!t || t.tagName !== "INPUT" || t.type !== "file") return;
    const p = read();
    if (!p) return;
    const f = t.files?.[0];
    if (e.type === "cancel" || !f) { clear(); return; }
    if (p.flow === "upload") { clear(); return; }
    cameraStage("file", { fileBytes: f.size, fileType: f.type, fileAfterMs: Date.now() - p.at });
    window.clearTimeout(aliveTimer);
    aliveTimer = window.setTimeout(clear, ALIVE_AFTER_FILE_MS);
  };
  document.addEventListener("change", onFileInput, true);
  document.addEventListener("cancel", onFileInput, true);
}

function deviceInfo(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  return {
    deviceMemoryGB: nav.deviceMemory ?? null,
    dpr: window.devicePixelRatio,
    screen: `${window.screen.width}x${window.screen.height}`,
    installedApp: !!standalone,
  };
}

/**
 * Call right before opening the native camera / photo picker.
 * flow "editor": the photo goes on to the editor (tracked until it shows);
 * flow "upload": the file is uploaded directly (done once it arrived).
 */
export function markCameraOpening(flow: Flow = "editor") {
  installListeners();
  window.clearTimeout(aliveTimer);
  write({
    path: window.location.pathname + window.location.search,
    at: Date.now(),
    flow,
    stage: "opened",
    stageAt: Date.now(),
    info: deviceInfo(),
  });
}

/** Same as markCameraOpening("upload"); usable directly as an onClick handler. */
export function markUploadCameraOpening() {
  markCameraOpening("upload");
}

/**
 * On app start: the interrupted round trip (and forgets it), if the app was
 * restarted during one; otherwise null.
 */
export function takeInterruptedCamera(): CameraPending | null {
  const p = read();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  if (!p?.path || typeof p.at !== "number" || Date.now() - p.at > MAX_AGE_MS) return null;
  return p;
}

/** A camera round trip is under way right now (camera open or photo on its way to the editor). */
export function cameraInProgress(): boolean {
  const p = read();
  return !!p && typeof p.at === "number" && Date.now() - p.at < MAX_AGE_MS;
}

/** True when the restart happened after the photo came back to the app. */
export function diedAfterReturn(p: CameraPending): boolean {
  return p.stage !== "opened";
}
