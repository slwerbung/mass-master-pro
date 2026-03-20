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

type LoginMode = "select" | "admin" | "employee" | "customer";

const Auth = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>("select");
  const [adminPassword, setAdminPassword] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string } | null>(null);
  const [storedEmployeePassword, setStoredEmployeePassword] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);

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
      supabase.from("employees").select("id, name").order("name").then(({ data }) => setEmployees(data || []));
      supabase.from("app_config").select("value").eq("key", "employee_password").maybeSingle().then(({ data }) => {
        setStoredEmployeePassword(data?.value || null);
      });
    } else if (mode === "customer") {
      supabase.from("customers").select("id, name").order("name").then(({ data }) => setCustomers(data || []));
    }
  }, [mode]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-admin", { body: { password: adminPassword } });
      if (error || !data?.valid) {
        toast.error(data?.error || "Falsches Passwort");
      } else if (data?.token) {
        setSession({ role: "admin", id: "admin", name: "Admin", authToken: data.token, expiresAt: data.expiresAt });
        toast.success("Als Admin angemeldet");
        navigate("/admin");
      } else {
        setSession({ role: "admin", id: "admin", name: "Admin" });
        localStorage.setItem("admin_pw", adminPassword);
        toast.success("Als Admin angemeldet");
        navigate("/admin");
      }
    } catch { toast.error("Verbindungsfehler"); }
    setLoading(false);
  };

  const handleEmployeeSelect = async (emp: { id: string; name: string }) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-employee", { body: { employeeId: emp.id } });
      if (!error && data?.requiresPassword) {
        setSelectedEmployee(emp);
      } else if (!error && data?.valid && data?.token) {
        setSession({ role: "employee", id: emp.id, name: emp.name, authToken: data.token, expiresAt: data.expiresAt });
        toast.success(`Angemeldet als ${emp.name}`);
        navigate("/projects");
      } else if (storedEmployeePassword) {
        setSelectedEmployee(emp);
      } else {
        setSession({ role: "employee", id: emp.id, name: emp.name });
        toast.success(`Angemeldet als ${emp.name}`);
        navigate("/projects");
      }
    } catch {
      if (storedEmployeePassword) {
        setSelectedEmployee(emp);
      } else {
        setSession({ role: "employee", id: emp.id, name: emp.name });
        toast.success(`Angemeldet als ${emp.name}`);
        navigate("/projects");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmployeePasswordLogin = async () => {
    if (!selectedEmployee) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-employee", { body: { employeeId: selectedEmployee.id, password: employeePassword } });
      if (!error && data?.valid && data?.token) {
        setSession({ role: "employee", id: selectedEmployee.id, name: selectedEmployee.name, authToken: data.token, expiresAt: data.expiresAt });
        toast.success(`Angemeldet als ${selectedEmployee.name}`);
        navigate("/projects");
      } else if (storedEmployeePassword && employeePassword === storedEmployeePassword) {
        setSession({ role: "employee", id: selectedEmployee.id, name: selectedEmployee.name });
        toast.success(`Angemeldet als ${selectedEmployee.name}`);
        navigate("/projects");
      } else {
        toast.error("Falsches Passwort");
        setEmployeePassword("");
      }
    } catch {
      if (storedEmployeePassword && employeePassword === storedEmployeePassword) {
        setSession({ role: "employee", id: selectedEmployee.id, name: selectedEmployee.name });
        toast.success(`Angemeldet als ${selectedEmployee.name}`);
        navigate("/projects");
      } else {
        toast.error("Verbindungsfehler");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerLogin = () => {
    const match = customers.find((c) => c.name.toLowerCase() === customerName.trim().toLowerCase());
    if (!match) { toast.error("Name nicht gefunden. Bitte wenden Sie sich an den Administrator."); return; }
    setSession({ role: "customer", id: match.id, name: match.name });
    toast.success(`Angemeldet als ${match.name}`);
    navigate("/customer");
  };

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
                    <Input id="admin-pw" type="password" className="pl-9" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Passwort eingeben" required autoFocus />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>{loading ? "Prüfe..." : "Anmelden"}</Button>
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
                      <Button key={emp.id} variant="outline" className="w-full justify-start" onClick={() => handleEmployeeSelect(emp)}>
                        <User className="h-4 w-4 mr-2" />{emp.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "employee" && selectedEmployee && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setSelectedEmployee(null)}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
              <p className="text-sm text-muted-foreground">Anmelden als <strong>{selectedEmployee.name}</strong></p>
              <div className="space-y-2">
                <Label htmlFor="emp-pw">Mitarbeiter-Passwort</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="emp-pw" type="password" className="pl-9" value={employeePassword}
                    onChange={(e) => setEmployeePassword(e.target.value)}
                    placeholder="Passwort eingeben" autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleEmployeePasswordLogin()} />
                </div>
              </div>
              <Button className="w-full" onClick={handleEmployeePasswordLogin} disabled={!employeePassword.trim() || loading}>
                {loading ? "Prüfe..." : "Anmelden"}
              </Button>
            </div>
          )}

          {mode === "customer" && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setMode("select")}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
              <div className="space-y-2">
                <Label htmlFor="customer-name">Ihr Name</Label>
                <Input id="customer-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Name eingeben" autoFocus onKeyDown={(e) => e.key === "Enter" && handleCustomerLogin()} />
              </div>
              <Button className="w-full" onClick={handleCustomerLogin} disabled={!customerName.trim()}>Weiter</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
