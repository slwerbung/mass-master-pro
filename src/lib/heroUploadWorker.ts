// Background worker that drains the hero-upload-queue. Started once on
// app init. Runs a loop that polls every tick seconds for due items,
// uploads them via the hero-upload-proxy edge function, and handles
// retries with exponential backoff.
//
// Design rules:
// - Must never throw into the main UI thread. All errors are swallowed
//   and logged, and retries are scheduled in IndexedDB.
// - Must tolerate offline. Pauses itself when navigator.onLine=false.
// - Must tolerate page refresh. Since the queue lives in IndexedDB,
//   state survives reloads and a fresh worker picks up where the last
//   one stopped.
// - Single instance guarantee: the start() function checks a module
//   flag so repeated imports/renders don't spawn multiple workers.

import { indexedDBStorage } from "./indexedDBStorage";
import { supabase } from "@/integrations/supabase/client";

// Poll interval while the queue has items. When idle (queue empty) we
// back off to a longer interval to save battery on mobile.
const TICK_BUSY_MS = 4_000;
const TICK_IDLE_MS = 30_000;
const MAX_ATTEMPTS = 5;

// Backoff schedule (ms since last attempt) - 1s, 10s, 1min, 5min, 30min.
// After 5 attempts we park the item. It stays in the queue and surfaces
// as "failed" in the UI indicator, but the worker won't retry it.
const BACKOFF_STEPS = [1_000, 10_000, 60_000, 300_000, 1_800_000];

let running = false;
let stopRequested = false;
// Reentrancy guard: set to true while processOne() is active. Prevents
// two parallel ticks from picking up the same queue item. Every call to
// pokeHeroUploadWorker() or a focus/online event can trigger a tick, so
// without this guard the same item gets uploaded multiple times.
let tickInProgress = false;
// If a poke arrives while a tick is running, we remember it and kick
// another tick as soon as the current one finishes. That way the worker
// stays promptly responsive without allowing concurrent runs.
let pokePending = false;

async function processOne(): Promise<boolean> {
  // Returns true if we processed an item (so we should tick again soon),
  // false if the queue was empty/we should idle.
  const due = await indexedDBStorage.getDueHeroUploads(5);
  const item = due[0];
  if (!item) return false;

  // Skip permanently-failed items - they stay in the queue for visibility
  // but the worker won't touch them again. User/admin can retry manually.
  if (item.attempts >= MAX_ATTEMPTS) return false;

  if (!item.heroProjectMatchId) {
    // Project wasn't linked to HERO when the upload was queued. Drop
    // silently - this was never going to reach HERO, and we shouldn't
    // keep retrying it.
    console.info("HeroUploadWorker: drop item without heroProjectMatchId", item.id);
    await indexedDBStorage.deleteHeroUpload(item.id);
    return true;
  }

  try {
    // Build the multipart form the edge function expects
    const form = new FormData();
    form.append("file", item.blob, item.filename);
    form.append("uploadType", item.uploadType);
    form.append("heroProjectMatchId", String(item.heroProjectMatchId));
    form.append("filename", item.filename);

    const { data, error } = await supabase.functions.invoke("hero-upload-proxy", {
      body: form,
    });

    if (error) {
      await scheduleRetry(item.id, item.attempts, `Transport: ${error.message || String(error)}`);
      return true;
    }
    if (!data?.ok) {
      await scheduleRetry(item.id, item.attempts, `${data?.step || "unknown"}: ${data?.error || "no error"}`);
      return true;
    }

    // Success - drop the item
    await indexedDBStorage.deleteHeroUpload(item.id);
    console.info(`HeroUploadWorker: uploaded ${item.uploadType} for project ${item.projectId} -> HERO file ${data.heroFileId}`);
    return true;

  } catch (e: any) {
    await scheduleRetry(item.id, item.attempts, e.message || String(e));
    return true;
  }
}

async function scheduleRetry(id: string, currentAttempts: number, error: string) {
  const stepIdx = Math.min(currentAttempts, BACKOFF_STEPS.length - 1);
  const delay = BACKOFF_STEPS[stepIdx];
  const nextAttemptAt = Date.now() + delay;
  await indexedDBStorage.updateHeroUploadAttempt(id, nextAttemptAt, error);
  console.warn(`HeroUploadWorker: retry ${currentAttempts + 1}/${MAX_ATTEMPTS} in ${Math.round(delay / 1000)}s - ${error}`);
}

async function tick() {
  if (stopRequested) return;

  // Mutex: only ONE tick may run at a time. If a poke arrives while a
  // tick is active, we remember it and re-run once this one finishes.
  // This prevents the concrete bug where two pokes in quick succession
  // (e.g. enqueueing two images back-to-back) caused the same queue item
  // to be picked up and uploaded twice.
  if (tickInProgress) {
    pokePending = true;
    return;
  }
  tickInProgress = true;

  // Pause gracefully while offline - we'll wake up on the online event.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    tickInProgress = false;
    scheduleNext(TICK_IDLE_MS);
    return;
  }

  try {
    const processed = await processOne();
    tickInProgress = false;
    // If a poke arrived mid-tick, handle it now so the worker stays
    // responsive without allowing concurrent runs.
    if (pokePending) {
      pokePending = false;
      tick();
      return;
    }
    scheduleNext(processed ? TICK_BUSY_MS : TICK_IDLE_MS);
  } catch (e) {
    // Catch-all so a bug here never kills the worker loop
    console.warn("HeroUploadWorker tick error", e);
    tickInProgress = false;
    scheduleNext(TICK_IDLE_MS);
  }
}

let nextTimer: number | null = null;
function scheduleNext(delayMs: number) {
  if (nextTimer !== null) window.clearTimeout(nextTimer);
  nextTimer = window.setTimeout(tick, delayMs);
}

// Listeners to react to online events and visibility - when the user
// brings the tab back into focus, we want to drain the queue promptly
// rather than waiting for the next idle tick.
function wakeUp() {
  if (nextTimer !== null) {
    window.clearTimeout(nextTimer);
    nextTimer = null;
  }
  tick();
}

export function startHeroUploadWorker() {
  if (running) return;
  running = true;
  stopRequested = false;

  if (typeof window !== "undefined") {
    window.addEventListener("online", wakeUp);
    window.addEventListener("focus", wakeUp);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") wakeUp();
    });
  }

  // Start with a small delay so we don't compete with initial page load
  scheduleNext(2_000);
  console.info("HeroUploadWorker started");
}

export function stopHeroUploadWorker() {
  stopRequested = true;
  running = false;
  if (nextTimer !== null) {
    window.clearTimeout(nextTimer);
    nextTimer = null;
  }
}

// Re-subscribe (in case startHeroUploadWorker has already been called)
// to get a fresh tick - used when a new item is enqueued so we don't
// wait the full idle cycle.
export function pokeHeroUploadWorker() {
  if (running) wakeUp();
}
