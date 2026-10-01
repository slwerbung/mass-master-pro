// Zugriff auf die Buchungs-API. Absichtlich klein gehalten: die Seiten sollen
// sich um Darstellung kuemmern, nicht um Query-Strings.
//
// Die Endpunkte sind oeffentlich (der Link ist der Zugang), deshalb steckt hier
// kein Token. Gerechnet wird alles serverseitig — das Frontend darf sich
// irren, ohne dass daraus eine Doppelbuchung wird.

import { supabase } from "@/integrations/supabase/client";

export interface BookingAddress {
  street?: string | null;
  zipcode?: string | null;
  city?: string | null;
  text?: string;
  source?: "project" | "customer" | "manual" | null;
  located?: boolean;
}

export interface AppointmentType {
  key: string;
  label: string;
  durationMinutes: number;
  formFields?: unknown[];
  bookingWindowDays?: number;
}

export interface BookingContext {
  /** null = Dauerlink eines Mitarbeiters, ohne Projektbezug. */
  project: { id: string; number: string; customerName: string; heroLinked: boolean } | null;
  /** Wer eingeladen hat. Dieser Mitarbeiter bekommt den Termin. */
  staff: { name: string; slug: string } | null;
  /** Alle buchbaren Terminarten. Bei einer geht es direkt zum Kalender. */
  appointments: AppointmentType[];
  address: BookingAddress | null;
  contact: { name: string; email: string | null; phone: string | null };
}

/** Beide Linkformen in einem Objekt — die Seite kennt nur dieses. */
export interface BookingTarget {
  projectId?: string | null;
  staffSlug?: string | null;
}

const ziel = (t: BookingTarget): Record<string, string> => ({
  ...(t.projectId ? { project: t.projectId } : {}),
  ...(t.staffSlug ? { staff: t.staffSlug } : {}),
});

export interface Slot {
  startsAt: string;
  endsAt: string;
  assignedStaffId?: string;
  staffIds?: string[];
}

/**
 * Die Fehlermeldung der Function herausholen.
 *
 * Bei einer Antwort ausserhalb von 2xx setzt supabase-js `data` auf null und
 * legt die Antwort als Response unter `error.context` ab. Ohne diesen Umweg
 * saehe der Kunde bei einem 409 "Edge Function returned a non-2xx status code"
 * statt "Dieser Termin wurde gerade vergeben." — im Oberflaechentest genau so
 * aufgefallen.
 */
async function fehlertext(error: unknown): Promise<string | null> {
  const resp = (error as { context?: unknown })?.context as Response | undefined;
  if (!resp || typeof resp.json !== "function") return null;
  try {
    const body = await resp.json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null; // kein JSON oder Body schon gelesen
  }
}

async function get<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const { data, error } = await supabase.functions.invoke(`booking-api?${qs}`, { method: "GET" });
  if (error) throw new Error((await fehlertext(error)) || error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("booking-api", { body });
  if (error) throw new Error((await fehlertext(error)) || error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export const loadBookingContext = (target: BookingTarget) =>
  get<BookingContext>({ action: "context", ...ziel(target) });

export const loadAvailability = (
  target: BookingTarget, ruleSet: string, from: string, to: string,
  address?: { street?: string; zip?: string; city?: string },
) =>
  get<{ slots: Slot[]; addressLocated: boolean }>({
    action: "availability", ...ziel(target), ruleSet, from, to,
    ...(address?.street ? { street: address.street } : {}),
    ...(address?.zip ? { zip: address.zip } : {}),
    ...(address?.city ? { city: address.city } : {}),
  });

export const createBooking = (payload: {
  project?: string | null;
  staff?: string | null;
  ruleSet: string;
  slot: { startsAt: string; endsAt: string };
  staffId: string;
  contact: { name: string; email: string; phone?: string };
  addressOverride?: { street?: string; zip?: string; city?: string } | null;
  hinweis?: string;
}) =>
  post<{
    ok: boolean;
    booking: { id: string; status: string; startsAt: string; endsAt: string };
    cancelToken: string;
    heroError: string | null;
  }>({ action: "create", ...payload });

export const cancelBooking = (cancelToken: string) =>
  post<{ ok: boolean; status: string; heroRemoved: boolean | null }>({ action: "cancel", cancelToken });

export const staffBookingAction = (staffToken: string, mode: "cancel" | "reschedule") =>
  post<{
    ok: boolean; status: string; mode: string; projectId: string | null;
    already?: boolean;
    /** true = HERO-Termin entfernt, false = blieb stehen, null = es gab keinen. */
    heroRemoved: boolean | null;
  }>({ action: "staff-action", staffToken, mode });

// ── Einladungen (Mitarbeiteransicht, deshalb mit Session-Token) ──

export interface BookingInviteLinks {
  slug: string;
  name: string;
  /** true = die Links tragen das Projekt mit. */
  mitProjekt: boolean;
  /**
   * Buchbare Terminarten, jede mit FERTIGEM Link. Die Terminart waehlt der
   * Mitarbeiter vor dem Verschicken — deshalb gibt es keinen Link "ohne Art".
   */
  appointments: (AppointmentType & { link: string })[];
  neuAngelegt: boolean;
}

async function invite<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("booking-invite", { body });
  if (error) throw new Error((await fehlertext(error)) || error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export const loadInviteLinks = (token: string, projectId?: string | null) =>
  invite<BookingInviteLinks>({ action: "link", token, ...(projectId ? { projectId } : {}) });

export const sendBookingInvite = (payload: {
  token: string;
  email: string;
  /** Pflicht: welche Terminart eingeladen wird. */
  ruleSet: string;
  projectId?: string | null;
  projectNumber?: string | null;
  note?: string;
}) => invite<{ ok: boolean; email: string; link: string; subject: string; ruleSet: string }>({ action: "send", ...payload });
