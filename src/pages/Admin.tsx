import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { LogOut, Plus, Trash2, User, Users, FolderOpen, Link } from "lucide-react";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Admin = () => {
  const navigate = useNavigate();
  const session = getSession();
  const adminPassword = session?.role === "admin" ? "stored" : "";

  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);

  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [assignProjectId, setAssignProjectId] = useState("");

  // We need the actual admin password for API calls
  const [storedAdminPw, setStoredAdminPw] = useState(() => {
    return localStorage.getItem("admin_pw") || "";
  });

  useEffect(() => {
    if (!session || session.role !== "admin") {
      navigate("/");
      return;
    }
    loadAll();
  }, []);

  const invoke = useCallback(async (action: string, params: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-manage", {
      body: { adminPassword: storedAdminPw, action, ...params },
    });
    if (error) throw new Error("Network error");
    if (data?.error) throw new Error(data.error);
    return data;
  }, [storedAdminPw]);

  const loadAll = useCallback(async () => {
    try {
      const [empRes, custRes, projRes, assignRes] = await Promise.all([
        invoke("list_employees"),
        invoke("list_customers"),
        invoke("list_projects"),
        invoke("list_assignments"),
      ]);
      setEmployees(empRes.employees || []);
      setCustomers(custRes.customers || []);
      setProjects(projRes.projects || []);
      setAssignments(assignRes.assignments || []);
    } catch (e: any) {
      toast.error(e.message || "Fehler beim Laden");
    }
  }, [invoke]);

  const handleLogout = () => {
    clearSession();
    localStorage.removeItem("admin_pw");
    navigate("/");
  };

  const addEmployee = async () => {
    if (!newEmployeeName.trim()) return;
    try {
      await invoke("create_employee", { name: newEmployeeName.trim() });
      setNewEmployeeName("");
      toast.success("Mitarbeiter erstellt");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    }
  };

  const deleteEmployee = async (id: string) => {
    try {
      await invoke("delete_employee", { employeeId: id });
      toast.success("Mitarbeiter gelöscht");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    }
  };

  const addCustomer = async () => {
    if (!newCustomerName.trim()) return;
    try {
      await invoke("create_customer", { name: newCustomerName.trim() });
      setNewCustomerName("");
      toast.success("Kunde erstellt");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    }
  };

  const deleteCustomer = async (id: string) => {
    try {
      await invoke("delete_customer", { customerId: id });
      toast.success("Kunde gelöscht");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    }
  };

  const addAssignment = async () => {
    if (!assignCustomerId || !assignProjectId) return;
    try {
      await invoke("create_assignment", {
        customerId: assignCustomerId,
        projectId: assignProjectId,
      });
      toast.success("Zuweisung erstellt");
      setAssignCustomerId("");
      setAssignProjectId("");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    }
  };

  const deleteAssignment = async (id: string) => {
    try {
      await invoke("delete_assignment", { assignmentId: id });
      toast.success("Zuweisung gelöscht");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Admin-Bereich</h1>
            <p className="text-muted-foreground text-sm">Verwaltung</p>
          </div>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-1" /> Abmelden
          </Button>
        </div>

        <Tabs defaultValue="employees">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="employees">Mitarbeiter</TabsTrigger>
            <TabsTrigger value="customers">Kunden</TabsTrigger>
            <TabsTrigger value="assignments">Zuweisungen</TabsTrigger>
            <TabsTrigger value="projects">Projekte</TabsTrigger>
          </TabsList>

          <TabsContent value="employees" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5" /> Mitarbeiter verwalten
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Name des Mitarbeiters"
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                  />
                  <Button onClick={addEmployee} disabled={!newEmployeeName.trim()}>
                    <Plus className="h-4 w-4 mr-1" /> Hinzufügen
                  </Button>
                </div>
                <div className="space-y-2">
                  {employees.map((emp) => (
                    <div key={emp.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="font-medium">{emp.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => deleteEmployee(emp.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {employees.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">Noch keine Mitarbeiter</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customers" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" /> Kunden verwalten
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Name des Kunden"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCustomer()}
                  />
                  <Button onClick={addCustomer} disabled={!newCustomerName.trim()}>
                    <Plus className="h-4 w-4 mr-1" /> Hinzufügen
                  </Button>
                </div>
                <div className="space-y-2">
                  {customers.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="font-medium">{c.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => deleteCustomer(c.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {customers.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">Noch keine Kunden</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignments" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Link className="h-5 w-5" /> Projekt-Zuweisungen
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Kunde</Label>
                    <Select value={assignCustomerId} onValueChange={setAssignCustomerId}>
                      <SelectTrigger><SelectValue placeholder="Kunde wählen" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Projekt</Label>
                    <Select value={assignProjectId} onValueChange={setAssignProjectId}>
                      <SelectTrigger><SelectValue placeholder="Projekt wählen" /></SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.project_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addAssignment} disabled={!assignCustomerId || !assignProjectId} className="w-full">
                      <Plus className="h-4 w-4 mr-1" /> Zuweisen
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {assignments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="text-sm">
                        <span className="font-medium">{a.customers?.name}</span>
                        {" → "}
                        <span className="font-medium">{a.projects?.project_number}</span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => deleteAssignment(a.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {assignments.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">Noch keine Zuweisungen</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projects" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" /> Alle Projekte
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div>
                        <span className="font-medium">{p.project_number}</span>
                        {p.employees?.name && (
                          <span className="text-sm text-muted-foreground ml-2">
                            · {p.employees.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {projects.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">Noch keine Projekte</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;
