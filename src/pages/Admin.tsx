import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { LogOut, Plus, Trash2, User, Users, FolderOpen, Link, Settings, Lock, ChevronDown, ChevronUp, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";

interface FieldConfig {
  id: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  field_options: string | null;
  sort_order: number;
  is_active: boolean;
  customer_visible: boolean;
}

const Admin = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [assignProjectId, setAssignProjectId] = useState("");
  const [employeePasswordConfigured, setEmployeePasswordConfigured] = useState(false);
  const [newEmployeePassword, setNewEmployeePassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldConfig["field_type"]>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [savingField, setSavingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldLabel, setEditFieldLabel] = useState("");
  const [editFieldType, setEditFieldType] = useState<FieldConfig["field_type"]>("text");
  const [editFieldOptions, setEditFieldOptions] = useState("");
  const adminToken = session?.authToken || "";
  const legacyAdminPw = typeof window !== "undefined" ? localStorage.getItem("admin_pw") || "" : "";

  const invoke = useCallback(async (action: string, params: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-manage", {
      body: { adminToken, adminPassword: legacyAdminPw, action, ...params },
    });
    if (error) throw new Error("Network error");
    if (data?.error) throw new Error(data.error);
    return data;
  }, [adminToken, legacyAdminPw]);

  useEffect(() => {
    if (!session || session.role !== "admin") { navigate("/"); return; }
    if (adminToken || legacyAdminPw) { loadAll(); loadEmployeePassword(); loadFields(); }
  }, [adminToken, legacyAdminPw]);

  const loadAll = useCallback(async () => {
    try {
      const [empRes, custRes, projRes, assignRes] = await Promise.all([
        invoke("list_employees"), invoke("list_customers"), invoke("list_projects"), invoke("list_assignments"),
      ]);
      setEmployees(empRes.employees || []);
      setCustomers(custRes.customers || []);
      setProjects(projRes.projects || []);
      setAssignments(assignRes.assignments || []);
    } catch (e: any) { toast.error(e.message || "Fehler beim Laden"); }
  }, [invoke]);

  const loadEmployeePassword = async () => {
    try {
      const data = await invoke("get_security_settings");
      setEmployeePasswordConfigured(!!data?.employeePasswordConfigured);
    } catch {
      const { data } = await supabase.from("app_config").select("value").eq("key", "employee_password").maybeSingle();
      setEmployeePasswordConfigured(!!data?.value);
    }
  };

  const saveEmployeePassword = async () => {
    if (!newEmployeePassword.trim()) return;
    setSavingPassword(true);
    try {
      await invoke("set_employee_password", { password: newEmployeePassword.trim() });
      setEmployeePasswordConfigured(true);
      setNewEmployeePassword("");
      toast.success("Passwort gespeichert");
    } catch {
      const { error } = await supabase.from("app_config").upsert({ key: "employee_password", value: newEmployeePassword.trim() });
      if (error) toast.error("Fehler beim Speichern");
      else {
        setEmployeePasswordConfigured(true);
        setNewEmployeePassword("");
        toast.success("Passwort gespeichert");
      }
    }
    setSavingPassword(false);
  };

  const loadFields = async () => {
    try {
      const data = await invoke("list_fields");
      setFields(mergeWithDefaultLocationFields((data.fields || []) as FieldConfig[]) as FieldConfig[]);
    } catch {
      const { data } = await supabase.from("location_field_config").select("*").order("sort_order");
      setFields(mergeWithDefaultLocationFields((data || []) as FieldConfig[]) as FieldConfig[]);
    }
  };

  const addField = async () => {
    if (!newFieldLabel.trim()) return;
    setSavingField(true);
    const fieldKey = `custom_${Date.now()}`;
    const maxOrder = fields.length > 0 ? Math.max(...fields.map(f => f.sort_order)) + 1 : 1;
    try {
      await invoke("create_field", {
        fieldKey,
        fieldLabel: newFieldLabel.trim(),
        fieldType: newFieldType,
        fieldOptions: newFieldType === "dropdown" && newFieldOptions.trim()
          ? newFieldOptions.split(",").map(s => s.trim()).filter(Boolean) : null,
        sortOrder: maxOrder,
      });
      setNewFieldLabel(""); setNewFieldOptions(""); setNewFieldType("text"); toast.success("Feld erstellt"); loadFields();
    } catch {
      const { error } = await supabase.from("location_field_config").insert({
        field_key: fieldKey,
        field_label: newFieldLabel.trim(),
        field_type: newFieldType,
        field_options: newFieldType === "dropdown" && newFieldOptions.trim() ? JSON.stringify(newFieldOptions.split(",").map(s => s.trim()).filter(Boolean)) : null,
        sort_order: maxOrder,
        is_active: true,
        customer_visible: true,
      });
      if (error) toast.error("Fehler beim Erstellen");
      else { setNewFieldLabel(""); setNewFieldOptions(""); setNewFieldType("text"); toast.success("Feld erstellt"); loadFields(); }
    }
    setSavingField(false);
  };

  const toggleField = async (field: FieldConfig) => {
    try {
      await invoke("update_field", { fieldId: field.id, changes: { is_active: !field.is_active } });
    } catch {
      await supabase.from("location_field_config").update({ is_active: !field.is_active }).eq("id", field.id);
    }
    loadFields();
  };

  const toggleCustomerVisibility = async (field: FieldConfig) => {
    try {
      await invoke("update_field", { fieldId: field.id, changes: { customer_visible: !field.customer_visible } });
    } catch {
      await supabase.from("location_field_config").update({ customer_visible: !field.customer_visible }).eq("id", field.id);
    }
    loadFields();
  };

  const startEditField = (field: FieldConfig) => {
    setEditingFieldId(field.id);
    setEditFieldLabel(field.field_label);
    setEditFieldType(field.field_type);
    try {
      const parsed = field.field_options ? JSON.parse(field.field_options) : [];
      setEditFieldOptions(Array.isArray(parsed) ? parsed.join(", ") : "");
    } catch {
      setEditFieldOptions("");
    }
  };

  const cancelEditField = () => {
    setEditingFieldId(null);
    setEditFieldLabel("");
    setEditFieldType("text");
    setEditFieldOptions("");
  };

  const saveFieldEdit = async (field: FieldConfig) => {
    const changes: any = {
      field_label: editFieldLabel.trim() || field.field_label,
      field_type: editFieldType,
      field_options: editFieldType === "dropdown" && editFieldOptions.trim()
        ? JSON.stringify(editFieldOptions.split(",").map(s => s.trim()).filter(Boolean))
        : null,
    };

    try {
      await invoke("update_field", { fieldId: field.id, changes });
    } catch {
      await supabase.from("location_field_config").update(changes).eq("id", field.id);
    }
    cancelEditField();
    loadFields();
    toast.success("Feld aktualisiert");
  };

  const deleteField = async (id: string) => {
    try {
      await invoke("delete_field", { fieldId: id });
    } catch {
      await supabase.from("location_field_config").delete().eq("id", id);
    }
    loadFields();
    toast.success("Feld gelöscht");
  };

  const moveField = async (id: string, direction: "up" | "down") => {
    const idx = fields.findIndex(f => f.id === id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === fields.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const current = fields[idx]; const swap = fields[swapIdx];
    try {
      await Promise.all([
        invoke("update_field", { fieldId: current.id, changes: { sort_order: swap.sort_order } }),
        invoke("update_field", { fieldId: swap.id, changes: { sort_order: current.sort_order } }),
      ]);
    } catch {
      await Promise.all([
        supabase.from("location_field_config").update({ sort_order: swap.sort_order }).eq("id", current.id),
        supabase.from("location_field_config").update({ sort_order: current.sort_order }).eq("id", swap.id),
      ]);
    }
    loadFields();
  };

  const handleLogout = () => { clearSession(); localStorage.removeItem("admin_pw"); navigate("/"); };
  const addEmployee = async () => { if (!newEmployeeName.trim()) return; try { await invoke("create_employee", { name: newEmployeeName.trim() }); setNewEmployeeName(""); toast.success("Mitarbeiter erstellt"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const deleteEmployee = async (id: string) => { try { await invoke("delete_employee", { employeeId: id }); toast.success("Gelöscht"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const addCustomer = async () => { if (!newCustomerName.trim()) return; try { await invoke("create_customer", { name: newCustomerName.trim() }); setNewCustomerName(""); toast.success("Kunde erstellt"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const deleteCustomer = async (id: string) => { try { await invoke("delete_customer", { customerId: id }); toast.success("Gelöscht"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const addAssignment = async () => { if (!assignCustomerId || !assignProjectId) return; try { await invoke("create_assignment", { customerId: assignCustomerId, projectId: assignProjectId }); toast.success("Zuweisung erstellt"); setAssignCustomerId(""); setAssignProjectId(""); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const deleteAssignment = async (id: string) => { try { await invoke("delete_assignment", { assignmentId: id }); toast.success("Gelöscht"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const fieldTypeLabel = (t: string) => ({ text: "Textfeld", textarea: "Textarea", dropdown: "Dropdown", checkbox: "Checkbox" }[t] || t);

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl md:text-3xl font-bold">Admin-Bereich</h1><p className="text-muted-foreground text-sm">Verwaltung</p></div>
          <Button variant="outline" onClick={handleLogout}><LogOut className="h-4 w-4 mr-1" /> Abmelden</Button>
        </div>
        <Tabs defaultValue="employees">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="employees">Mitarbeiter</TabsTrigger>
            <TabsTrigger value="customers">Kunden</TabsTrigger>
            <TabsTrigger value="assignments">Zuweisungen</TabsTrigger>
            <TabsTrigger value="projects">Projekte</TabsTrigger>
            <TabsTrigger value="settings">Einstellungen</TabsTrigger>
          </TabsList>

          <TabsContent value="employees" className="space-y-4 mt-4">
            <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5" /> Mitarbeiter verwalten</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2"><Input placeholder="Name des Mitarbeiters" value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEmployee()} /><Button onClick={addEmployee} disabled={!newEmployeeName.trim()}><Plus className="h-4 w-4 mr-1" /> Hinzufügen</Button></div>
                <div className="space-y-2">{employees.map((emp) => (<div key={emp.id} className="flex items-center justify-between p-3 bg-muted rounded-lg"><span className="font-medium">{emp.name}</span><Button variant="ghost" size="sm" onClick={() => deleteEmployee(emp.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>))}{employees.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Mitarbeiter</p>}</div>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="customers" className="space-y-4 mt-4">
            <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5" /> Kunden verwalten</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2"><Input placeholder="Name des Kunden" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomer()} /><Button onClick={addCustomer} disabled={!newCustomerName.trim()}><Plus className="h-4 w-4 mr-1" /> Hinzufügen</Button></div>
                <div className="space-y-2">{customers.map((c) => (<div key={c.id} className="flex items-center justify-between p-3 bg-muted rounded-lg"><span className="font-medium">{c.name}</span><Button variant="ghost" size="sm" onClick={() => deleteCustomer(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>))}{customers.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Kunden</p>}</div>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="assignments" className="space-y-4 mt-4">
            <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><Link className="h-5 w-5" /> Projekt-Zuweisungen</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1"><Label className="text-xs">Kunde</Label><Select value={assignCustomerId} onValueChange={setAssignCustomerId}><SelectTrigger><SelectValue placeholder="Kunde wählen" /></SelectTrigger><SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label className="text-xs">Projekt</Label><Select value={assignProjectId} onValueChange={setAssignProjectId}><SelectTrigger><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number}</SelectItem>)}</SelectContent></Select></div>
                  <div className="flex items-end"><Button onClick={addAssignment} disabled={!assignCustomerId || !assignProjectId} className="w-full"><Plus className="h-4 w-4 mr-1" /> Zuweisen</Button></div>
                </div>
                <div className="space-y-2">{assignments.map((a) => (<div key={a.id} className="flex items-center justify-between p-3 bg-muted rounded-lg"><span className="text-sm"><span className="font-medium">{a.customers?.name}</span>{" → "}<span className="font-medium">{a.projects?.project_number}</span></span><Button variant="ghost" size="sm" onClick={() => deleteAssignment(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>))}{assignments.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Zuweisungen</p>}</div>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="projects" className="space-y-4 mt-4">
            <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Alle Projekte</CardTitle></CardHeader>
              <CardContent><div className="space-y-2">{projects.map((p) => (<div key={p.id} className="flex items-center justify-between p-3 bg-muted rounded-lg"><div><span className="font-medium">{p.project_number}</span>{p.employees?.name && <span className="text-sm text-muted-foreground ml-2">· {p.employees.name}</span>}</div></div>))}{projects.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Projekte</p>}</div></CardContent></Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5" /> Mitarbeiter-Passwort</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Status: {employeePasswordConfigured ? <strong>Passwort gesetzt</strong> : <strong>Kein Passwort gesetzt</strong>}</p>
                <div className="flex gap-2">
                  <Input type="text" placeholder="Neues Mitarbeiter-Passwort" value={newEmployeePassword} onChange={(e) => setNewEmployeePassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEmployeePassword()} />
                  <Button onClick={saveEmployeePassword} disabled={!newEmployeePassword.trim() || savingPassword}>Speichern</Button>
                </div>
                <p className="text-xs text-muted-foreground">Mitarbeiter müssen dieses Passwort beim Login eingeben.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Settings className="h-5 w-5" /> Standortfelder konfigurieren</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Hier legst du fest, welche Standortfelder intern genutzt werden und welche davon der Kunde in seiner Ansicht sehen darf.</p>
                <div className="space-y-2">
                  {fields.map((field, idx) => {
                    const isEditing = editingFieldId === field.id;
                    return (
                    <div key={field.id || field.field_key} className={`p-3 rounded-lg border space-y-3 ${field.is_active ? "bg-background" : "bg-muted opacity-60"}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col gap-0.5">
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => field.id && moveField(field.id, "up")} disabled={idx === 0 || !field.id}><ChevronUp className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => field.id && moveField(field.id, "down")} disabled={idx === fields.length - 1 || !field.id}><ChevronDown className="h-3 w-3" /></Button>
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          {isEditing ? (
                            <div className="space-y-2">
                              <Input value={editFieldLabel} onChange={(e) => setEditFieldLabel(e.target.value)} placeholder="Feldbezeichnung" />
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Select value={editFieldType} onValueChange={(v) => setEditFieldType(v as FieldConfig["field_type"])}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="text">Textfeld (einzeilig)</SelectItem>
                                    <SelectItem value="textarea">Textarea (mehrzeilig)</SelectItem>
                                    <SelectItem value="dropdown">Dropdown (Auswahl)</SelectItem>
                                    <SelectItem value="checkbox">Checkbox (Ja/Nein)</SelectItem>
                                  </SelectContent>
                                </Select>
                                {editFieldType === "dropdown" ? <Input value={editFieldOptions} onChange={(e) => setEditFieldOptions(e.target.value)} placeholder="Optionen, kommagetrennt" /> : <div />}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{field.field_label}</span>
                                <Badge variant="outline" className="text-xs">{fieldTypeLabel(field.field_type)}</Badge>
                                {!field.is_active && <Badge variant="secondary" className="text-xs">Intern ausgeblendet</Badge>}
                                {!field.customer_visible && <Badge variant="secondary" className="text-xs">Für Kunden ausgeblendet</Badge>}
                              </div>
                              {field.field_options && <p className="text-xs text-muted-foreground mt-0.5 truncate">Optionen: {JSON.parse(field.field_options).join(", ")}</p>}
                            </>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {isEditing ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => saveFieldEdit(field)}><Save className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={cancelEditField}><X className="h-4 w-4" /></Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => startEditField(field)} disabled={!field.id}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => field.id && deleteField(field.id)} disabled={!field.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-center justify-between rounded border px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">Intern sichtbar</p>
                            <p className="text-xs text-muted-foreground">Feld erscheint in der App für Mitarbeiter/Admin</p>
                          </div>
                          <Switch checked={field.is_active} onCheckedChange={() => toggleField(field)} disabled={!field.id} />
                        </div>
                        <div className="flex items-center justify-between rounded border px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">Für Kunden sichtbar</p>
                            <p className="text-xs text-muted-foreground">Dieses Feld wird in der Kundenansicht eingeblendet</p>
                          </div>
                          <Switch checked={field.customer_visible} onCheckedChange={() => toggleCustomerVisibility(field)} disabled={!field.id} />
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
                <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                  <p className="text-sm font-medium">Neues Feld hinzufügen</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Bezeichnung</Label><Input placeholder="z.B. Größe, Farbe..." value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} /></div>
                    <div className="space-y-1"><Label className="text-xs">Feldtyp</Label>
                      <Select value={newFieldType} onValueChange={(v) => setNewFieldType(v as FieldConfig["field_type"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Textfeld (einzeilig)</SelectItem>
                          <SelectItem value="textarea">Textarea (mehrzeilig)</SelectItem>
                          <SelectItem value="dropdown">Dropdown (Auswahl)</SelectItem>
                          <SelectItem value="checkbox">Checkbox (Ja/Nein)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {newFieldType === "dropdown" && (
                    <div className="space-y-1"><Label className="text-xs">Optionen (kommagetrennt)</Label><Input placeholder="z.B. Klein, Mittel, Groß" value={newFieldOptions} onChange={(e) => setNewFieldOptions(e.target.value)} /></div>
                  )}
                  <Button onClick={addField} disabled={!newFieldLabel.trim() || savingField} size="sm"><Plus className="h-4 w-4 mr-1" /> Feld hinzufügen</Button>
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
