import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, User, Users, ArrowLeft, Lock, Car, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { setSession, getSession } from "@/lib/session";
import { indexedDBStorage } from "@/lib/indexedDBStorage";

// ─── Rate limiting ────────────────────────────────────────────────────────────
const RATE_LIMIT_KEY = 'mmp_login_attempts';
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 30_000;

function getRateLimit(): { count: number; lockedUntil?: number } {
  try { return JSON.parse(sessionStorage.getItem(RATE_LIMIT_KEY) || '{"count":0}'); }
  catch { return { count: 0 }; }
}

function setRateLimit(value: { count: number; lockedUntil?: number }) {
  try { sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(value)); } catch {}
}

function checkRateLimit(): { allowed: boolean; remainingSeconds?: number } {
  const rl = getRateLimit();
  if (rl.lockedUntil && Date.now() < rl.lockedUntil) {
    return { allowed: false, remainingSeconds: Math.ceil((rl.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true };
}

function recordFailedAttempt() {
  const rl = getRateLimit();
  const count = (rl.count || 0) + 1;
  setRateLimit({ count, lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : undefined });
}

function resetRateLimit() {
  sessionStorage.removeItem(RATE_LIMIT_KEY);
}

const SESSION_CACHE_KEY = "session_validation_cache";
function setLoginCache(role: string, token: string, userId: string) {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      key: `${role}:${token}:${userId}`,
      ts: Date.now(),
      valid: true,
    }));
  } catch {}
}

type LoginMode = "select" | "admin" | "employee" | "customer";

const Auth = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>("select");
  const [adminPassword, setAdminPassword] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string } | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // Where to send the user after a successful login. Comes from the
  // ?next=... query parameter set by RoleGuard when an unauthenticated
  // user tries to open a protected page (e.g. clicking a "Projekt
  // öffnen" link in a notification email). We only honor app-internal
  // paths to prevent open-redirect attacks.
  const getPostLoginTarget = (defaultPath: string): string => {
    try {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    } catch {}
    return defaultPath;
  };

  // Countdown timer for lockout display
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setTimeout(() => setLockoutSeconds(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockoutSeconds]);

  useEffect(() => {
    const session = getSession();
    if (session) {
      if (session.role === "admin") navigate(getPostLoginTarget("/admin"));
      else if (session.role === "employee") navigate(getPostLoginTarget("/projects"));
      else if (session.role === "customer") navigate(getPostLoginTarget("/customer"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (mode === "employee") {
      supabase.from("employees_public" as any).select("id, name").order("name").then(({ data }: any) => setEmployees(data || []));
    }
    // mode === "customer" no longer needs to pre-load the list; the name is
    // matched server-side via validate-customer.
  }, [mode]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rl = checkRateLimit();
    if (!rl.allowed) {
      setLockoutSeconds(rl.remainingSeconds || LOCKOUT_MS / 1000);
      toast.error(`Zu viele Versuche. Bitte warte ${rl.remainingSeconds} Sekunden.`);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-admin", { body: { password: adminPassword } });
      if (error || !data?.valid) {
        recordFailedAttempt();
        const newRl = checkRateLimit();
        if (!newRl.allowed) {
          setLockoutSeconds(newRl.remainingSeconds || LOCKOUT_MS / 1000);
          toast.error(`Falsches Passwort. Login für ${newRl.remainingSeconds} Sekunden gesperrt.`);
        } else {
          toast.error(data?.error || "Falsches Passwort");
        }
      } else if (data?.token) {
        resetRateLimit();
        setSession({ role: "admin", id: "admin", name: "Admin", authToken: data.token, expiresAt: data.expiresAt });
        setLoginCache("admin", data.token, "admin");
        toast.success("Als Admin angemeldet");
        navigate(getPostLoginTarget("/admin"));
      }
    } catch { toast.error("Verbindungsfehler"); }
    setLoading(false);
  };

  const handleEmployeeSelect = async (emp: { id: string; name: string }) => {
    const rl = checkRateLimit();
    if (!rl.allowed) {
      setLockoutSeconds(rl.remainingSeconds || LOCKOUT_MS / 1000);
      toast.error(`Zu viele Versuche. Bitte warte ${rl.remainingSeconds} Sekunden.`);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-employee", { body: { employeeId: emp.id } });
      if (error) { toast.error("Verbindungsfehler"); setLoading(false); return; }
      if (data?.requiresPassword) {
        setSelectedEmployee(emp);
      } else if (data?.valid && data?.token) {
        resetRateLimit();
        const prev = getSession();
        if (prev?.id && prev.id !== emp.id) await indexedDBStorage.clearAll();
        setSession({ role: "employee", id: emp.id, name: emp.name, authToken: data.token, expiresAt: data.expiresAt });
        setLoginCache("employee", data.token, emp.id);
        toast.success(`Angemeldet als ${emp.name}`);
        navigate(getPostLoginTarget("/projects"));
      } else {
        toast.error("Login fehlgeschlagen");
      }
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  const handleEmployeePasswordLogin = async () => {
    if (!selectedEmployee) return;
    const rl = checkRateLimit();
    if (!rl.allowed) {
      setLockoutSeconds(rl.remainingSeconds || LOCKOUT_MS / 1000);
      toast.error(`Zu viele Versuche. Bitte warte ${rl.remainingSeconds} Sekunden.`);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-employee", { body: { employeeId: selectedEmployee.id, password: employeePassword } });
      if (error) { toast.error("Verbindungsfehler"); }
      else if (data?.valid && data?.token) {
        resetRateLimit();
        const prev = getSession();
        if (prev?.id && prev.id !== selectedEmployee.id) await indexedDBStorage.clearAll();
        setSession({ role: "employee", id: selectedEmployee.id, name: selectedEmployee.name, authToken: data.token, expiresAt: data.expiresAt });
        setLoginCache("employee", data.token, selectedEmployee.id);
        toast.success(`Angemeldet als ${selectedEmployee.name}`);
        navigate(getPostLoginTarget("/projects"));
      } else {
        recordFailedAttempt();
        const newRl = checkRateLimit();
        if (!newRl.allowed) {
          setLockoutSeconds(newRl.remainingSeconds || LOCKOUT_MS / 1000);
          toast.error(`Falsches Passwort. Login für ${newRl.remainingSeconds} Sekunden gesperrt.`);
        } else {
          toast.error("Falsches Passwort");
        }
        setEmployeePassword("");
      }
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerLogin = async () => {
    const trimmedName = customerName.trim();
    if (!trimmedName) return;
    const rl = checkRateLimit();
    if (!rl.allowed) {
      setLockoutSeconds(rl.remainingSeconds || LOCKOUT_MS / 1000);
      toast.error(`Zu viele Versuche. Bitte warte ${rl.remainingSeconds} Sekunden.`);
      return;
    }
    setLoading(true);
    try {
      // Validate against server and get a signed token – UX stays identical
      // (type name → submit), but customer-data now requires this token.
      const { data, error } = await supabase.functions.invoke("validate-customer", {
        body: { customerName: trimmedName },
      });
      if (error) { toast.error("Verbindungsfehler"); return; }
      if (!data?.valid || !data?.token || !data?.customer) {
        recordFailedAttempt();
        const newRl = checkRateLimit();
        if (!newRl.allowed) {
          setLockoutSeconds(newRl.remainingSeconds || LOCKOUT_MS / 1000);
          toast.error(`Name nicht gefunden. Login für ${newRl.remainingSeconds} Sekunden gesperrt.`);
        } else {
          toast.error("Name nicht gefunden. Bitte wenden Sie sich an den Administrator.");
        }
        return;
      }
      resetRateLimit();
      setSession({
        role: "customer",
        id: data.customer.id,
        name: data.customer.name,
        authToken: data.token,
        expiresAt: data.expiresAt,
      });
      setLoginCache("customer", data.token, data.customer.id);
      toast.success(`Angemeldet als ${data.customer.name}`);
      navigate(getPostLoginTarget("/customer"));
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockoutSeconds > 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Captfix</CardTitle>
          <CardDescription>{mode === "select" ? "Was möchten Sie tun?" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "select" && (
            <div className="space-y-6">
              {/* Logins: Mitarbeiter + Kunde gleich gewichtet, da beides
                  Bestandskunden / -mitarbeiter mit eigenem Account sind.

                  Alle Buttons sind `min-h-16` statt `h-16` und nutzen
                  `whitespace-normal` damit Subtitle auf schmalen
                  Viewports umbricht statt überzulaufen. */}
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full min-h-16 h-auto py-3 justify-start gap-3 text-left"
                  onClick={() => setMode("employee")}
                >
                  <User className="h-6 w-6 text-primary shrink-0" />
                  <div className="min-w-0 flex-1 whitespace-normal">
                    <div className="font-semibold break-words">MITARBEITER-LOGIN</div>
                    <div className="text-xs text-muted-foreground break-words">Projekte erstellen & bearbeiten</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="w-full min-h-16 h-auto py-3 justify-start gap-3 text-left"
                  onClick={() => setMode("customer")}
                >
                  <Users className="h-6 w-6 text-primary shrink-0" />
                  <div className="min-w-0 flex-1 whitespace-normal">
                    <div className="font-semibold break-words">KUNDEN-LOGIN</div>
                    <div className="text-xs text-muted-foreground break-words">Zugewiesene Projekte ansehen</div>
                  </div>
                </Button>
              </div>

              {/* Public forms - für Erstkontakt ohne Account */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">Anliegen einreichen</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <Button
                  variant="outline"
                  className="w-full min-h-16 h-auto py-3 justify-start gap-3 text-left"
                  onClick={() => navigate("/fahrzeug-anfrage")}
                >
                  <Car className="h-6 w-6 text-primary shrink-0" />
                  <div className="min-w-0 flex-1 whitespace-normal">
                    <div className="font-semibold break-words">FAHRZEUG EINREICHEN</div>
                    <div className="text-xs text-muted-foreground break-words">Fahrzeugdaten angeben für Beschriftung und Folierung</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="w-full min-h-16 h-auto py-3 justify-start gap-3 text-left"
                  onClick={() => navigate("/neukunde")}
                >
                  <UserPlus className="h-6 w-6 text-primary shrink-0" />
                  <div className="min-w-0 flex-1 whitespace-normal">
                    <div className="font-semibold break-words">ALS NEUKUNDE ANMELDEN</div>
                    <div className="text-xs text-muted-foreground break-words">Erstanlage als Privat- oder Geschäftskunde</div>
                  </div>
                </Button>
              </div>

              {/* Admin-Login: ganz unten, dezent als Text-Link */}
              <div className="pt-2 border-t">
                <div className="flex items-center justify-center text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                    onClick={() => setMode("admin")}
                  >
                    Admin-Login
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === "admin" && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setMode("select")}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-pw">Admin-Passwort</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input id="admin-pw" type="password" className="pl-9" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Passwort eingeben" required autoFocus disabled={isLocked} />
                  </div>
                </div>
                {isLocked && (
                  <p className="text-sm text-destructive text-center">Login gesperrt – noch {lockoutSeconds} Sekunden</p>
                )}
                <Button type="submit" className="w-full" disabled={loading || isLocked}>
                  {loading ? "Prüfe..." : isLocked ? `Gesperrt (${lockoutSeconds}s)` : "Anmelden"}
                </Button>
              </form>
            </div>
          )}

          {mode === "employee" && !selectedEmployee && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setMode("select")}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
              {employees.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Noch keine Mitarbeiter angelegt.</p>
              ) : (
                <div className="space-y-2">
                  <Label>Mitarbeiter auswählen</Label>
                  <div className="grid gap-2 max-h-64 overflow-y-auto">
                    {employees.map((emp) => (
                      <Button key={emp.id} variant="outline" className="w-full justify-start" onClick={() => handleEmployeeSelect(emp)} disabled={loading || isLocked}>
                        <User className="h-4 w-4 mr-2" />{emp.name}
                      </Button>
                    ))}
                  </div>
                  {isLocked && <p className="text-sm text-destructive text-center">Login gesperrt – noch {lockoutSeconds} Sekunden</p>}
                </div>
              )}
            </div>
          )}

          {mode === "employee" && selectedEmployee && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => { setSelectedEmployee(null); setEmployeePassword(""); }}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
              <p className="text-sm text-muted-foreground">Anmelden als <strong>{selectedEmployee.name}</strong></p>
              <div className="space-y-2">
                <Label htmlFor="emp-pw">Passwort</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="emp-pw" type="password" className="pl-9" value={employeePassword}
                    onChange={(e) => setEmployeePassword(e.target.value)}
                    placeholder="Passwort eingeben" autoFocus disabled={isLocked}
                    onKeyDown={(e) => e.key === "Enter" && handleEmployeePasswordLogin()} />
                </div>
              </div>
              {isLocked && <p className="text-sm text-destructive text-center">Login gesperrt – noch {lockoutSeconds} Sekunden</p>}
              <Button className="w-full" onClick={handleEmployeePasswordLogin} disabled={!employeePassword.trim() || loading || isLocked}>
                {loading ? "Prüfe..." : isLocked ? `Gesperrt (${lockoutSeconds}s)` : "Anmelden"}
              </Button>
            </div>
          )}

          {mode === "customer" && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setMode("select")}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
              <div className="space-y-2">
                <Label htmlFor="customer-name">Ihr Name</Label>
                <Input id="customer-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Name eingeben" autoFocus disabled={isLocked || loading}
                  onKeyDown={(e) => e.key === "Enter" && !loading && handleCustomerLogin()} />
              </div>
              {isLocked && <p className="text-sm text-destructive text-center">Login gesperrt – noch {lockoutSeconds} Sekunden</p>}
              <Button className="w-full" onClick={handleCustomerLogin} disabled={!customerName.trim() || loading || isLocked}>
                {loading ? "Prüfe..." : isLocked ? `Gesperrt (${lockoutSeconds}s)` : "Weiter"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
