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
