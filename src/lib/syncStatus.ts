export type SyncState = {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const STORAGE_KEY = 'app_sync_status';
const EVENT_NAME = 'app-sync-status-changed';

const defaultState: SyncState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  lastSyncedAt: null,
  lastError: null,
};

function readState(): SyncState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return defaultState;
  }
}

function emit(state: SyncState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: state }));
  }
}

export function getSyncState(): SyncState { return readState(); }
export function updateSyncState(patch: Partial<SyncState>) { emit({ ...readState(), ...patch }); }
export function setSyncOnlineState(isOnline: boolean) { updateSyncState({ isOnline }); }
export function startSync() { updateSyncState({ isSyncing: true, lastError: null, isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true }); }
export function finishSyncSuccess() { updateSyncState({ isSyncing: false, lastSyncedAt: new Date().toISOString(), lastError: null, isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true }); }
export function finishSyncError(error: unknown) { updateSyncState({ isSyncing: false, lastError: error instanceof Error ? error.message : String(error || 'Unbekannter Fehler'), isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true }); }

export function subscribeToSyncState(callback: (state: SyncState) => void): () => void {
  const handler = (event?: Event) => callback((event as CustomEvent<SyncState> | undefined)?.detail || readState());
  if (typeof window !== 'undefined') {
    const onlineHandler = () => setSyncOnlineState(true);
    const offlineHandler = () => setSyncOnlineState(false);
    window.addEventListener(EVENT_NAME, handler as EventListener);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    callback(readState());
    return () => {
      window.removeEventListener(EVENT_NAME, handler as EventListener);
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }
  callback(readState());
  return () => {};
}
