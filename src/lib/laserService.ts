// Singleton BLE connection to a Leica DISTO / Würth WDM 3-19 laser.
//
// The Würth WDM 3-19 is a rebadged Leica DISTO D2; both expose the same
// custom GATT service. All Web Bluetooth specifics live here so that:
//   (a) one connection is shared across every measurement dialog and stays
//       alive for the whole editor session — the user pairs the device once,
//   (b) if the laser sleeps / drops out of range and BLE disconnects, we
//       AUTO-RECONNECT in the background without a new device-picker prompt,
//   (c) there is a single seam to swap for native CoreBluetooth in the
//       future Capacitor/iOS wrapper (replace this module's internals only).
//
// Protocol (reverse-engineered, Leica DISTO D2):
//   Service       3ab10100-...           (Leica custom)
//   Measurement   3ab10101-...  4 bytes  IEEE754 float, device's configured
//                                        unit (default METERS), read + indicate
//   Units         3ab10102-...  2 bytes  changes on each new measurement
//
// IMPORTANT: the laser must be set to METERS (its default). The float is in
// whatever unit the device is configured to; we assume meters → mm. Raw bytes
// are logged so a wrong unit setting is immediately visible during testing.

export const LEICA_SERVICE = "3ab10100-f831-4395-b29d-570977d5bf94";
export const LEICA_MEASUREMENT_CHAR = "3ab10101-f831-4395-b29d-570977d5bf94";
export const LEICA_UNITS_CHAR = "3ab10102-f831-4395-b29d-570977d5bf94";
const BATTERY_SERVICE = "battery_service"; // 0x180F
const DEVICE_INFO_SERVICE = "device_information"; // 0x180A
const STORED_ID_KEY = "laserDeviceId";

export function laserSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Decode a Leica measurement characteristic value into millimetres.
 * 4-byte little-endian IEEE754 float in metres. Returns null for
 * error/sentinel values (out of range, NaN, <= 0).
 */
export function decodeLeicaMeasurement(view: DataView): { mm: number; meters: number } | null {
  if (view.byteLength < 4) return null;
  const meters = view.getFloat32(0, /* littleEndian */ true);
  if (!Number.isFinite(meters)) return null;
  // Device range is 0.05–100 m; outside is an error/sentinel
  // (e.g. the ~255 "too close" value seen on these devices).
  if (meters <= 0 || meters > 150) return null;
  return { mm: Math.round(meters * 1000), meters };
}

export type LaserState = "unsupported" | "disconnected" | "connecting" | "connected";
type MeasurementHandler = (mm: number, meters: number) => void;

// ── module state ─────────────────────────────────────────────────────────
let device: any = null;
let measureChar: any = null;
let currentHandler: MeasurementHandler | null = null;
let manualDisconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let restoring = false;
const MAX_RECONNECT_ATTEMPTS = 30;
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 15000;

let state: LaserState = laserSupported() ? "disconnected" : "unsupported";
const stateSubs = new Set<(s: LaserState) => void>();
let debugSink: ((msg: string) => void) | null = null;

function setState(next: LaserState) {
  if (state === next) return;
  state = next;
  stateSubs.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
}
function debug(msg: string) { try { debugSink?.(msg); } catch { /* ignore */ } }

export function getLaserState(): LaserState { return state; }
export function subscribeLaserState(fn: (s: LaserState) => void): () => void {
  stateSubs.add(fn);
  return () => stateSubs.delete(fn);
}
export function setDebugSink(fn: ((msg: string) => void) | null) { debugSink = fn; }
export function setMeasurementHandler(handler: MeasurementHandler | null) { currentHandler = handler; }
export function isLaserConnected(): boolean { return !!device?.gatt?.connected; }

// ── internals ──────────────────────────────────────────────────────────--
function handleMeasurementEvent(event: Event) {
  const view: DataView = (event.target as any).value;
  const decoded = decodeLeicaMeasurement(view);
  if (decoded) {
    debug(`Messung: ${decoded.meters.toFixed(3)} m → ${decoded.mm} mm`);
    currentHandler?.(decoded.mm, decoded.meters);
  } else {
    const bytes = Array.from(new Uint8Array(view.buffer))
      .map((b) => b.toString(16).padStart(2, "0")).join(" ");
    debug(`Roh (ungültig): ${bytes}`);
  }
}

function handleUnitsEvent(event: Event) {
  const view: DataView = (event.target as any).value;
  const bytes = Array.from(new Uint8Array(view.buffer))
    .map((b) => b.toString(16).padStart(2, "0")).join(" ");
  debug(`Einheiten-Code: ${bytes}`);
}

// Connect the GATT server and (re)subscribe to characteristics. Throws
// Error("no-service") if the picked device isn't a Leica/Würth laser.
async function openConnection() {
  const server = await device.gatt?.connect();
  if (!server) throw new Error("GATT-Verbindung fehlgeschlagen");

  let service: any;
  try {
    service = await server.getPrimaryService(LEICA_SERVICE);
  } catch {
    throw new Error("no-service");
  }

  measureChar = await service.getCharacteristic(LEICA_MEASUREMENT_CHAR);
  await measureChar.startNotifications(); // works for indicate too
  measureChar.addEventListener("characteristicvaluechanged", handleMeasurementEvent);
  debug("Messwert abonniert ✓");

  // Read the current value once (a measurement may already be on display).
  try {
    const cur = await measureChar.readValue();
    const decoded = decodeLeicaMeasurement(cur);
    if (decoded) currentHandler?.(decoded.mm, decoded.meters);
  } catch { /* read-on-connect may be empty, ignore */ }

  // Optionally observe the units characteristic (debug unit codes).
  try {
    const unitsChar = await service.getCharacteristic(LEICA_UNITS_CHAR);
    await unitsChar.startNotifications();
    unitsChar.addEventListener("characteristicvaluechanged", handleUnitsEvent);
  } catch { /* units char optional, ignore */ }
}

function onGattDisconnected() {
  measureChar = null;
  if (manualDisconnect) return;
  // Unexpected drop (sleep / out of range): keep the device reference and
  // try to reconnect in the background — no new device-picker needed.
  debug("Verbindung getrennt – Auto-Reconnect…");
  setState("disconnected");
  scheduleReconnect();
}

function scheduleReconnect() {
  if (!device || manualDisconnect) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    debug("Auto-Reconnect aufgegeben (Gerät bitte manuell neu verbinden)");
    return;
  }
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.3, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts += 1;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    if (!device || manualDisconnect || isLaserConnected()) return;
    try {
      debug(`Reconnect-Versuch ${reconnectAttempts}…`);
      setState("connecting");
      await openConnection();
      reconnectAttempts = 0;
      setState("connected");
      debug("Wieder verbunden ✓");
    } catch {
      setState("disconnected");
      scheduleReconnect();
    }
  }, delay);
}

function attachDevice(d: any) {
  device = d;
  device.removeEventListener?.("gattserverdisconnected", onGattDisconnected);
  device.addEventListener?.("gattserverdisconnected", onGattDisconnected);
  try { localStorage.setItem(STORED_ID_KEY, device.id); } catch { /* ignore */ }
}

// ── public API ─────────────────────────────────────────────────────────--
/**
 * Connect to the laser (requires a user gesture for the first pairing).
 * Reuses an existing device handle without re-prompting. Throws:
 *   - Error("unsupported")  Web Bluetooth not available (e.g. iOS Safari)
 *   - Error("no-service")   the picked device is not a Leica/Würth laser
 *   - DOMException "NotFoundError"  user cancelled the device picker
 */
export async function connectLaser(): Promise<void> {
  if (!laserSupported()) throw new Error("unsupported");
  if (isLaserConnected()) { debug("Bereits verbunden"); return; }

  setState("connecting");
  manualDisconnect = false;
  reconnectAttempts = 0;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  try {
    if (!device) {
      // First pairing — needs the picker (user gesture).
      const picked = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [LEICA_SERVICE, BATTERY_SERVICE, DEVICE_INFO_SERVICE],
      });
      attachDevice(picked);
      debug(`Gerät: ${device.name || "Unbekannt"}`);
    }
    await openConnection();
    setState("connected");
    debug("Verbunden ✓");
  } catch (err: any) {
    if (err?.name === "NotFoundError") {
      // User cancelled the picker: drop the (unset) device, stay idle.
      device = null;
      setState("disconnected");
      throw err;
    }
    if (err?.message === "no-service") {
      // Not a laser — forget it so the next attempt re-opens the picker.
      try { device?.gatt?.disconnect(); } catch { /* ignore */ }
      device = null;
      setState("disconnected");
      throw err;
    }
    setState("disconnected");
    throw err;
  }
}

/** Explicit teardown (not wired to any button; connection is meant to persist). */
export function disconnectLaser() {
  manualDisconnect = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
  try { device?.gatt?.disconnect(); } catch { /* ignore */ }
  device = null;
  measureChar = null;
  setState(laserSupported() ? "disconnected" : "unsupported");
}

/**
 * Best-effort restore of a previously paired laser across a page reload,
 * using the persistent-permissions getDevices() API (Chrome 85+). Silently
 * no-ops where unsupported. Re-uses the stored device id so no picker shows.
 */
export async function tryRestoreLaser(): Promise<void> {
  if (!laserSupported() || device || restoring) return;
  const bt: any = (navigator as any).bluetooth;
  if (typeof bt.getDevices !== "function") return;
  restoring = true;
  try {
    const known = await bt.getDevices();
    if (!known?.length) return;
    let storedId: string | null = null;
    try { storedId = localStorage.getItem(STORED_ID_KEY); } catch { /* ignore */ }
    const match = known.find((d: any) => d.id === storedId);
    if (!match) return;
    attachDevice(match);
    manualDisconnect = false;
    reconnectAttempts = 0;
    setState("connecting");
    debug("Stelle vorherige Laser-Verbindung wieder her…");
    try {
      await openConnection();
      reconnectAttempts = 0;
      setState("connected");
      debug("Sitzung wiederhergestellt ✓");
    } catch {
      // Device probably asleep — let the background loop pick it up when it wakes.
      setState("disconnected");
      scheduleReconnect();
    }
  } catch {
    /* ignore restore failures */
  } finally {
    restoring = false;
  }
}
