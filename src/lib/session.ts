export type UserRole = 'admin' | 'employee' | 'customer';

export interface Session {
  role: UserRole;
  id: string; // employee or customer id, 'admin' for admin
  name: string;
  authToken?: string;
  expiresAt?: string;
}

const SESSION_KEY = 'app_session';

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Übernimmt die vom Server ausgestellte Supabase-Session in den Browser.
 * Für Mitarbeiter und Kunden gleichermaßen: ohne sie läuft jede Abfrage
 * weiterhin über den öffentlichen Anon-Key. Fehlt die Session (ältere
 * Function-Version, Netzwerkproblem), passiert nichts – der Login gilt
 * trotzdem, die Ansicht bleibt bedienbar.
 */
export async function applySupabaseSession(session: unknown) {
  const s = session as { access_token?: string; refresh_token?: string } | null | undefined;
  if (!s?.access_token || !s?.refresh_token) return;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  } catch {
    /* Ansicht funktioniert auch ohne */
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  forgetLogin();
  // Signierte Storage-Links gehoerten zur alten Sitzung.
  void import("./storageUrl").then(({ clearSignedUrlCache }) => clearSignedUrlCache()).catch(() => {});
  // Mitarbeiter haben zusaetzlich eine echte Supabase-Session. Beim Abmelden
  // muss auch die weg, sonst bleibt der Browser als `authenticated` angemeldet.
  // Bewusst ohne await: die Abmeldung darf die Navigation nicht aufhalten.
  void import("@/integrations/supabase/client")
    .then(({ supabase }) => supabase.auth.signOut())
    .catch(() => {});
}

export function hasRoleToken(session: Session | null) {
  return !!session?.authToken && !!session?.expiresAt;
}

// ─── "Angemeldet bleiben" (Mitarbeiter) ───────────────────────────────────────
// Das App-Token (HMAC) lebt 12 h. Hat der Mitarbeiter "Angemeldet bleiben"
// gewaehlt, merken wir uns nur DASS er angemeldet bleiben will (kein Passwort,
// kein Token). Laeuft das Token ab, holt renewEmployeeSession() mit der im
// Browser gespeicherten Supabase-Session ein neues (employee-auth "refresh").
// Abmelden (clearSession) loescht beides.

const REMEMBER_KEY = "app_session_remember";
/** So lange vor Ablauf wird das Token schon im Voraus erneuert. */
const RENEW_BEFORE_MS = 3 * 60 * 60 * 1000;

interface RememberedLogin {
  role: "employee";
  id: string;
  name: string;
}

export function rememberLogin(login: RememberedLogin) {
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(login)); } catch { /* ohne Speicher eben nicht */ }
}

export function forgetLogin() {
  try { localStorage.removeItem(REMEMBER_KEY); } catch { /* egal */ }
}

export function getRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as RememberedLogin;
    return v?.role === "employee" && v.id ? v : null;
  } catch {
    return null;
  }
}

/** Sitzung laeuft bald ab (oder ist schon weg) und darf erneuert werden. */
export function sessionNeedsRenewal(): boolean {
  const remembered = getRememberedLogin();
  if (!remembered) return false;
  const session = getSession();
  if (!session) return true;
  if (session.role !== "employee" || session.id !== remembered.id) return false;
  if (!session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() - Date.now() < RENEW_BEFORE_MS;
}

let renewing: Promise<Session | null> | null = null;

/**
 * Stellt fuer einen gemerkten Mitarbeiter ein neues App-Token aus.
 * Gibt die neue Sitzung zurueck, sonst null (dann gilt: neu anmelden).
 * Mehrfachaufrufe teilen sich eine Anfrage.
 */
export function renewEmployeeSession(): Promise<Session | null> {
  if (renewing) return renewing;
  renewing = (async () => {
    const remembered = getRememberedLogin();
    if (!remembered) return null;
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      // getSession() frischt ein abgelaufenes Access-Token selbst auf.
      const { data: auth } = await supabase.auth.getSession();
      const accessToken = auth.session?.access_token;
      if (!accessToken) { forgetLogin(); return null; }
      const { data, error } = await supabase.functions.invoke("employee-auth", {
        body: { action: "refresh" },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error || !data?.valid || !data?.token || !data?.employee?.id) {
        // Nur bei klarer Absage vergessen; ein Netzwerkfehler soll den
        // Mitarbeiter nicht abmelden (naechster Versuch spaeter).
        const status = (error as { context?: { status?: number } } | null)?.context?.status;
        if (!error || status === 401 || status === 403) forgetLogin();
        return null;
      }
      if (data.employee.id !== remembered.id) { forgetLogin(); return null; }
      const session: Session = {
        role: "employee",
        id: data.employee.id,
        name: data.employee.name || remembered.name,
        authToken: data.token,
        expiresAt: data.expiresAt,
      };
      setSession(session);
      rememberLogin({ role: "employee", id: session.id, name: session.name });
      return session;
    } catch {
      return null;
    }
  })().finally(() => { renewing = null; });
  return renewing;
}
