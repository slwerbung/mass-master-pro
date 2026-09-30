// Heavy background work (image sync, HERO uploads) waits for a quiet moment.
//
// Field data (client_diagnostics, Sept. 2026): the app was ended while the
// phone camera was open – typically on the SECOND photo of a project, a few
// seconds after the first location had been saved. Exactly then the debounced
// sync used to start: it read every image of the project as base64, hashed and
// re-encoded them, all at once. While the camera app is in front, Android ends
// background apps by memory size – ours was the biggest.
//
// So heavy work only runs when
//   - the app is in the foreground,
//   - no camera round trip is under way (cameraGuard),
//   - no photo is being edited (editor / location details), and
//   - this has been true for a few seconds (not right after coming back).
// Work pauses between images, so at most one image is in flight when the
// camera opens.

import { cameraInProgress } from "./cameraGuard";

const SETTLE_MS = 3000;
const POLL_MS = 1000;
// Pages that hold a full-size photo in memory while the user works on it.
const PHOTO_ROUTE = /\/(camera|editor|edit-image|location-details)(\/|$)|\/details\/[^/]+\/edit$|\/locations\/[^/]+\/edit$/;

let lastBusyAt = 0;

function busyNow(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState !== "visible"
    || cameraInProgress()
    || PHOTO_ROUTE.test(window.location.pathname);
}

if (typeof document !== "undefined") {
  // Coming back to the foreground starts the settle period again.
  document.addEventListener("visibilitychange", () => { lastBusyAt = Date.now(); });
}

/** Heavy background work may run right now. */
export function isQuiet(): boolean {
  if (busyNow()) { lastBusyAt = Date.now(); return false; }
  return Date.now() - lastBusyAt >= SETTLE_MS;
}

/** Resolves as soon as heavy background work may run. */
export function waitForQuiet(): Promise<void> {
  if (isQuiet()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => { if (isQuiet()) resolve(); else window.setTimeout(check, POLL_MS); };
    window.setTimeout(check, POLL_MS);
  });
}
