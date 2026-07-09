// In-memory hand-off for large image payloads between routes.
//
// React Router's `state` is serialized into the browser's history.state.
// Mobile Safari/WebKit caps that payload hard: a 1–4 MB base64 photo throws a
// QuotaExceeded/DataCloneError on pushState (or is silently dropped), which
// aborted the Aufmaß flow right after confirming a photo — the editor then saw
// no image and bounced back to the project ("Kein Bild gefunden").
//
// Keeping the payload in plain JS memory sidesteps that entirely: it survives
// client-side (SPA) navigation and is consumed exactly once by the next screen.
// A full page reload loses it, which is acceptable — the user just retakes.

export interface EditorHandoff {
  imageData?: string;
  originalImageData?: string;
  areaMeasurements?: unknown;
}

let payload: EditorHandoff | null = null;

export function setEditorHandoff(p: EditorHandoff): void {
  payload = p;
}

/** Reads and clears the pending payload (single consumption). */
export function takeEditorHandoff(): EditorHandoff | null {
  const p = payload;
  payload = null;
  return p;
}
