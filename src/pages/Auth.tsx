import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, User, Users, ArrowLeft, Lock } from "lucide-react";
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

  // Countdown timer for lockout display
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setTimeout(() => setLockoutSeconds(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockoutSeconds]);

  useEffect(() => {
    const session = getSession();
    if (session) {
      if (session.role === "admin") navigate("/admin");
      else if (session.role === "employee") navigate("/projects");
      else if (session.role === "customer") navigate("/customer");
    }
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
        navigate("/admin");
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
        navigate("/projects");
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
        navigate("/projects");
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
      navigate("/customer");
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
          <CardTitle className="text-2xl">Aufmaß-App</CardTitle>
          <CardDescription>{mode === "select" ? "Bitte wählen Sie Ihre Rolle" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "select" && (
            <div className="space-y-3">
              <Button variant="outline" className="w-full h-16 justify-start gap-3 text-left" onClick={() => setMode("admin")}>
                <Shield className="h-6 w-6 text-primary shrink-0" />
                <div><div className="font-semibold">Admin</div><div className="text-xs text-muted-foreground">Verwaltung & Einstellungen</div></div>
              </Button>
              <Button variant="outline" className="w-full h-16 justify-start gap-3 text-left" onClick={() => setMode("employee")}>
                <User className="h-6 w-6 text-primary shrink-0" />
                <div><div className="font-semibold">Mitarbeiter</div><div className="text-xs text-muted-foreground">Projekte erstellen & bearbeiten</div></div>
              </Button>
              <Button variant="outline" className="w-full h-16 justify-start gap-3 text-left" onClick={() => setMode("customer")}>
                <Users className="h-6 w-6 text-primary shrink-0" />
                <div><div className="font-semibold">Kunde</div><div className="text-xs text-muted-foreground">Zugewiesene Projekte ansehen</div></div>
              </Button>
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
