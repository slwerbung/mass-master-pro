// Client für die Edge Function `probo-catalog`.
//
// Der Probo-Token liegt ausschließlich serverseitig; hier geht nur der
// signierte Session-Token des angemeldeten Mitarbeiters/Admins raus.

import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

export interface ProboProduct {
  code: string;
  name: string;
  description: string;
  category: string;
}

export interface ProboProductDetail {
  code: string;
  name: string;
  description: string;
  images: { language: string; url: string }[];
  properties: { label: string; value: string }[];
}

/** Fehler mit Statuscode, damit Aufrufer 404 (Produkt fehlt) erkennen können. */
export class ProboError extends Error {
  status: number;
  notFound: boolean;

  constructor(message: string, status: number, notFound = false) {
    super(message);
    this.name = "ProboError";
    this.status = status;
    this.notFound = notFound;
  }
}

async function callProbo<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const session = getSession();
  if (!session?.authToken) {
    throw new ProboError("Nicht angemeldet – bitte neu einloggen.", 401);
  }

  const { data, error } = await supabase.functions.invoke("probo-catalog", {
    body: { action, token: session.authToken, ...params },
  });

  // invoke() wirft bei Non-2xx einen FunctionsHttpError, dessen Body die
  // eigentliche Meldung enthält. Ohne dieses Auslesen sieht der Nutzer nur
  // "Edge Function returned a non-2xx status code".
  if (error) {
    const response = (error as { context?: Response }).context;
    let message = error.message;
    const status = response?.status ?? 500;
    let notFound = status === 404;
    if (response) {
      try {
        const body = await response.clone().json();
        if (body?.error) message = body.error;
        if (body?.notFound) notFound = true;
      } catch {
        /* Body war kein JSON – dann bleibt die generische Meldung */
      }
    }
    throw new ProboError(message, status, notFound);
  }

  return data as T;
}

export async function fetchProboProducts(): Promise<{ products: ProboProduct[]; warning?: string }> {
  return callProbo<{ products: ProboProduct[]; warning?: string }>("list");
}

export async function fetchProboProductDetail(code: string): Promise<ProboProductDetail> {
  const data = await callProbo<{ product: ProboProductDetail }>("detail", { code });
  return data.product;
}

/**
 * Lädt ein Produktbild über den Proxy der Edge Function als Data-URL.
 * Direkt die CDN-URL an `<Image>` zu geben scheitert, sobald Probos CDN
 * keine CORS-Header schickt.
 */
export async function fetchProboImage(url: string): Promise<string> {
  const data = await callProbo<{ dataUrl: string }>("image", { url });
  return data.dataUrl;
}

/**
 * Wählt das passende Bild: konfigurierte Sprache -> "all" -> erstes Bild.
 */
export function pickImageUrl(
  images: { language: string; url: string }[],
  language = "de",
): string | null {
  if (!images.length) return null;
  const byLanguage = images.find((image) => image.language?.toLowerCase() === language.toLowerCase());
  if (byLanguage) return byLanguage.url;
  const generic = images.find((image) => image.language?.toLowerCase() === "all");
  if (generic) return generic.url;
  return images[0].url;
}

/**
 * `@react-pdf/renderer` bettet nur JPEG und PNG ein. Probos CDN liefert
 * teilweise WebP – das rechnet der Browser über ein Canvas in PNG um.
 * JPEG/PNG werden unverändert durchgereicht.
 */
export async function toPdfCompatibleImage(dataUrl: string): Promise<string> {
  if (/^data:image\/(jpeg|jpg|png);/i.test(dataUrl)) return dataUrl;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Bild konnte nicht dekodiert werden."));
    element.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar.");
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Arbeitet eine Liste in kleinen Gruppen ab statt alles auf einmal –
 * schont Probos Rate Limit und den Browser-Speicher bei vielen Bildern.
 */
export async function runInBatches<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  batchSize = 4,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item, offset) => fn(item, i + offset)));
  }
}
