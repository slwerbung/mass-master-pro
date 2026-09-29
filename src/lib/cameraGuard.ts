// Detects when the phone killed the app while the native camera was open.
//
// Taking a photo through <input capture> hands control to the camera app. On
// many phones (Android in particular) the OS frees memory by ending the
// browser/PWA in the background; after "Foto verwenden" the app starts from
// scratch, the photo is gone and the user lands on the start page without a
// word. The code can't prevent that, but it can notice it:
//
//   - right before opening the camera we store where the user was,
//   - if the page survives (it gets the photo, a cancel, or simply focus back)
//     the marker is removed again,
//   - if a fresh marker is still there when the app starts, the page was
//     restarted in between → bring the user back and explain what happened.

const KEY = "camera-pending";
// Older markers are ignored: nobody spends longer than this in the camera.
const MAX_AGE_MS = 10 * 60 * 1000;

interface Pending {
  path: string;
  at: number;
}

let survivalListenersInstalled = false;

function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Coming back to a still-running page means no restart happened.
function clearSoon() {
  window.setTimeout(clear, 1500);
}

function installSurvivalListeners() {
  if (survivalListenersInstalled) return;
  survivalListenersInstalled = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") clearSoon(); });
  window.addEventListener("focus", clearSoon);
  window.addEventListener("pageshow", clearSoon);
  // A file arrived or the picker was cancelled – the page is obviously alive.
  const onFileInputEvent = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (t && t.tagName === "INPUT" && t.type === "file") clear();
  };
  document.addEventListener("change", onFileInputEvent, true);
  document.addEventListener("cancel", onFileInputEvent, true);
}

/** Call right before opening the native camera / photo picker. */
export function markCameraOpening() {
  installSurvivalListeners();
  try {
    const pending: Pending = { path: window.location.pathname + window.location.search, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch { /* storage unavailable – detection simply won't work */ }
}

/**
 * On app start: returns where the user was if the app was restarted while the
 * camera was open (and forgets it), otherwise null.
 */
export function takeInterruptedCamera(): Pending | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const p = JSON.parse(raw) as Pending;
    if (!p?.path || typeof p.at !== "number" || Date.now() - p.at > MAX_AGE_MS) return null;
    return p;
  } catch {
    return null;
  }
}
