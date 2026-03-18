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

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function hasRoleToken(session: Session | null) {
  return !!session?.authToken && !!session?.expiresAt;
}
