
export type UserRole = 'admin' | 'employee' | 'customer';

export interface Session {
  role: UserRole;
  id: string; // employee or customer id, 'admin' for admin
  name: string;
}

const SESSION_KEY = 'app_session';

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
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
