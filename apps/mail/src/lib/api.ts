// Alle Daten kommen ueber die Edge Function `email-api` (die E-Mail-Tabellen sind
// fuer die Oberflaeche gesperrt). Antworten sind immer HTTP 200 mit { ok, data | error }.

import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // Bei Nicht-2xx (z. B. Absturz der Function) steckt die echte Meldung in der Antwort.
    let detail = "";
    const res = (error as { context?: unknown }).context;
    if (res instanceof Response) {
      try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
    }
    throw new ApiError(`${fn}: ${error.message || "Anfrage fehlgeschlagen"}${detail ? ` – ${detail}` : ""}`);
  }
  if (!data || data.ok !== true) throw new ApiError(data?.error || "Unbekannter Fehler", data?.code);
  return data.data as T;
}

export const api = <T = unknown>(action: string, params: Record<string, unknown> = {}) =>
  call<T>("email-api", { action, ...params });

export const invokeFn = <T = unknown>(fn: string, params: Record<string, unknown> = {}) => call<T>(fn, params);
