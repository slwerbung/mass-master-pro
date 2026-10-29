// Push-Benachrichtigungen im Browser: Service Worker (public/sw.js) anmelden und das Abo an email-api geben.
// iPhone/iPad: nur, wenn die App ueber „Zum Home-Bildschirm“ installiert ist (iOS 16.4+).

import { api } from "./api";

export interface PushStatus { publicKey: string; prefs: { decide: boolean; incoming: boolean }; devices: number; subscribed: boolean }

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => { /* ohne SW nur keine Benachrichtigungen */ });
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

function keyBytes(b64url: string): Uint8Array {
  const t = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4 || 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Auf diesem Geraet einschalten: Erlaubnis fragen, abonnieren, beim Server anmelden. */
export async function enablePush(publicKey: string): Promise<void> {
  if (!pushSupported()) throw new Error("Dieser Browser kann keine Benachrichtigungen empfangen.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Benachrichtigungen sind im Browser nicht erlaubt (Website-Einstellungen).");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // Abo mit einem anderen Server-Schluessel (z. B. alter Stand) ersetzen.
  const own = keyBytes(publicKey);
  const subKey = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && subKey && (subKey.length !== own.length || subKey.some((b, i) => b !== own[i]))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: own as BufferSource });
  await api("push_subscribe", { subscription: sub.toJSON(), userAgent: navigator.userAgent });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("push_unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
