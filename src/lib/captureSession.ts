// Durable capture session: a new photo survives an app restart at every step
// between "photo arrived" and "location saved".
//
// Before, every hand-off in that chain lived only in JS memory
// (editorHandoff.ts): camera → editor → location details → IndexedDB. Any
// restart in between (Android ending the app in the background, the browser
// reloading the page after running out of memory) lost the photo and all
// measurements drawn on it. Now:
//
//   photo arrives  → startCapture(file, editorPath)       stage "photo"
//   editor edits   → saveCaptureDraft(overlayJson)        stage "photo" (+draft)
//   editor done    → saveCaptureResult(result, nextPath)  stage "edited"
//   location saved → clearCapture()
//
// The editor / location details / vehicle page fall back to this record when
// their in-memory hand-off is missing, and CaptureRecoveryNotice offers to
// continue after a restart. The only gap left is Android ending the app WHILE
// the camera is open – then the photo never reached the page (see
// cameraGuard.ts).
//
// Own tiny database on purpose: the main schema (indexedDBStorage.ts) stays
// untouched. Images are stored as Blobs, never as base64 strings.

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "captfix-capture";
const STORE = "session";
const KEY = "current";
// Older sessions are ignored (and dropped) – nobody resumes a photo a day later.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CaptureResult {
  annotated: Blob;
  original?: Blob;
  areaMeasurements?: unknown;
}

export interface CaptureSession {
  id: typeof KEY;
  createdAt: number;
  updatedAt: number;
  /** Editor route incl. query (the query carries detail/floorPlan/vehicle context). */
  editorPath: string;
  /** The photo exactly as it came from the camera / picker. */
  photo: Blob;
  stage: "photo" | "edited";
  /** Editor overlay (lines, areas, text) without the background photo. */
  draft?: string;
  /** Editor output, once the user tapped ✓. */
  result?: CaptureResult;
  /** Where the editor output goes next (location details / vehicle page). */
  nextPath?: string;
  /** Editor loads of this photo that never reached the screen – crash-loop guard. */
  editorLoads: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

// Never let persistence problems (private mode, quota) break the normal flow:
// the in-memory hand-off still works, only the restart safety net is missing.
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.warn("captureSession:", e); return fallback; }
}

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/** A new photo arrived for the editor. Replaces any unfinished session. */
export function startCapture(photo: Blob, editorPath: string): Promise<void> {
  const now = Date.now();
  return safe(async () => {
    await (await db()).put(STORE, {
      id: KEY, createdAt: now, updatedAt: now, editorPath, photo, stage: "photo", editorLoads: 0,
    } satisfies CaptureSession);
  }, undefined);
}

export function getCapture(): Promise<CaptureSession | null> {
  return safe(async () => {
    const s = (await (await db()).get(STORE, KEY)) as CaptureSession | undefined;
    if (!s) return null;
    if (Date.now() - s.updatedAt > MAX_AGE_MS) { await clearCapture(); return null; }
    return s;
  }, null);
}

async function update(patch: Partial<CaptureSession>): Promise<void> {
  await safe(async () => {
    const d = await db();
    const s = (await d.get(STORE, KEY)) as CaptureSession | undefined;
    if (!s) return;
    await d.put(STORE, { ...s, ...patch, updatedAt: Date.now() });
  }, undefined);
}

/** Counts an editor (re)load of the session photo; returns the new count. */
export async function noteEditorLoad(): Promise<number> {
  const s = await getCapture();
  if (!s) return 0;
  const n = (s.editorLoads || 0) + 1;
  await update({ editorLoads: n });
  return n;
}

/** The photo is on screen in the editor – reset the crash-loop counter. */
export function noteEditorShown(): Promise<void> {
  return update({ editorLoads: 0 });
}

export function saveCaptureDraft(draft: string): Promise<void> {
  return update({ draft });
}

export function saveCaptureResult(result: CaptureResult, nextPath: string): Promise<void> {
  return update({ stage: "edited", result, nextPath });
}

export function clearCapture(): Promise<void> {
  return safe(async () => { await (await db()).delete(STORE, KEY); }, undefined);
}

/** Where to continue: the editor, or the step after it. */
export function resumePath(s: CaptureSession): string {
  return s.stage === "edited" && s.nextPath ? s.nextPath : s.editorPath;
}

// ── small helpers ─────────────────────────────────────────────────────────
// (data URL → Blob: dataUrlToBlob in heroSyncHelpers.ts)
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
