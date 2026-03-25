import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { LogOut, Plus, Trash2, User, Users, FolderOpen, Link, Settings, Lock, ChevronDown, ChevronUp, Pencil, Save, X, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface FieldConfig {
  id: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  field_options: string | null;
  sort_order: number;
  is_active: boolean;
  customer_visible: boolean;
  applies_to: string;
  is_required: boolean;
}

const APPLIES_TO_LABELS: Record<string, string> = {
  all: "Alle",
  aufmass: "Nur Aufmaß",
  aufmass_mit_plan: "Nur Aufmaß mit Plan",
};

const Admin = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeePasswordInput, setNewEmployeePasswordInput] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [assignProjectId, setAssignProjectId] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [savingAdminPassword, setSavingAdminPassword] = useState(false);
  const [projectPrefix, setProjectPrefix] = useState("");
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldConfig["field_type"]>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [newFieldAppliesTo, setNewFieldAppliesTo] = useState("all");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldLabel, setEditFieldLabel] = useState("");
  const [editFieldType, setEditFieldType] = useState<FieldConfig["field_type"]>("text");
  const [editFieldOptions, setEditFieldOptions] = useState("");
  const [editFieldAppliesTo, setEditFieldAppliesTo] = useState("all");
  const [editFieldRequired, setEditFieldRequired] = useState(false);
  // Employee password dialog
  const [passwordDialogEmployee, setPasswordDialogEmployee] = useState<any | null>(null);
  const [dialogPassword, setDialogPassword] = useState("");
  const [savingEmpPassword, setSavingEmpPassword] = useState(false);

  const adminToken = session?.authToken || "";

  const invoke = useCallback(async (action: string, params: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-manage", {
      body: { adminToken, action, ...params },
    });
    if (error) throw new Error(data?.error || error.message || "Netzwerkfehler");
    if (data?.error) throw new Error(data.error);
    return data;
  }, [adminToken]);

  useEffect(() => {
    if (!session || session.role !== "admin") { navigate("/"); return; }
    if (adminToken) { loadAll(); loadFields(); loadPrefix(); }
  }, [adminToken]);

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

  const saveAdminPassword = async () => {
    if (!newAdminPassword.trim()) return;
    setSavingAdminPassword(true);
    try {
      await invoke("set_admin_password", { password: newAdminPassword.trim() });
      setNewAdminPassword("");
      toast.success("Admin-Passwort gespeichert");
    } catch (e: any) { toast.error(e.message || "Fehler beim Speichern"); }
    setSavingAdminPassword(false);
  };

  const loadPrefix = async () => {
    try {
      const data = await invoke("get_project_prefix");
      setProjectPrefix(data.prefix ?? "WER-");
    } catch { setProjectPrefix(""); }
  };

  const savePrefix = async () => {
    setSavingPrefix(true);
    try {
      await invoke("set_project_prefix", { prefix: projectPrefix });
      toast.success("Präfix gespeichert");
    } catch (e: any) { toast.error(e.message || "Fehler"); }
    setSavingPrefix(false);
  };

  const loadFields = async () => {
    try {
      const data = await invoke("list_fields");
      setFields((data.fields || []) as FieldConfig[]);
    } catch {
      const { data } = await supabase.from("location_field_config").select("*").order("sort_order");
      setFields((data || []) as FieldConfig[]);
    }
  };

  const addField = async () => {
    if (!newFieldLabel.trim()) return;
    setSavingField(true);
    const fieldKey = `custom_${Date.now()}`;
    const maxOrder = fields.length > 0 ? Math.max(...fields.map(f => f.sort_order)) + 1 : 0;
    try {
      await invoke("create_field", {
        fieldKey,
        fieldLabel: newFieldLabel.trim(),
        fieldType: newFieldType,
        fieldOptions: newFieldType === "dropdown" && newFieldOptions.trim()
          ? newFieldOptions.split(",").map(s => s.trim()).filter(Boolean) : null,
        sortOrder: maxOrder,
        appliesTo: newFieldAppliesTo,
        isRequired: newFieldRequired,
      });
      setNewFieldLabel(""); setNewFieldOptions(""); setNewFieldType("text");
      setNewFieldAppliesTo("all"); setNewFieldRequired(false);
      toast.success("Feld erstellt"); loadFields();
    } catch (e: any) { toast.error(e.message || "Fehler beim Erstellen"); }
    setSavingField(false);
  };

  const toggleField = async (field: FieldConfig) => {
    try { await invoke("update_field", { fieldId: field.id, changes: { is_active: !field.is_active } }); } catch {}
    loadFields();
  };

  const toggleCustomerVisibility = async (field: FieldConfig) => {
    try { await invoke("update_field", { fieldId: field.id, changes: { customer_visible: !field.customer_visible } }); } catch {}
    loadFields();
  };

  const startEditField = (field: FieldConfig) => {
    setEditingFieldId(field.id);
    setEditFieldLabel(field.field_label);
    setEditFieldType(field.field_type);
    setEditFieldAppliesTo(field.applies_to || "all");
    setEditFieldRequired(field.is_required ?? false);
    try {
      const parsed = field.field_options ? JSON.parse(field.field_options) : [];
      setEditFieldOptions(Array.isArray(parsed) ? parsed.join(", ") : "");
    } catch { setEditFieldOptions(""); }
  };

  const cancelEditField = () => {
    setEditingFieldId(null); setEditFieldLabel(""); setEditFieldType("text");
    setEditFieldOptions(""); setEditFieldAppliesTo("all"); setEditFieldRequired(false);
  };

  const saveFieldEdit = async (field: FieldConfig) => {
    const changes: any = {
      field_label: editFieldLabel.trim() || field.field_label,
      field_type: editFieldType,
      field_options: editFieldType === "dropdown" && editFieldOptions.trim()
        ? JSON.stringify(editFieldOptions.split(",").map(s => s.trim()).filter(Boolean)) : null,
      applies_to: editFieldAppliesTo,
      is_required: editFieldRequired,
    };
    try { await invoke("update_field", { fieldId: field.id, changes }); } catch {}
    cancelEditField(); loadFields(); toast.success("Feld aktualisiert");
  };

  const deleteField = async (id: string) => {
    try { await invoke("delete_field", { fieldId: id }); } catch {}
    loadFields(); toast.success("Feld gelöscht");
  };

  const moveField = async (id: string, direction: "up" | "down") => {
    const sorted = [...fields];
    const idx = sorted.findIndex(f => f.id === id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === sorted.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    // Swap in array
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    // Reassign sequential sort_order values
    try {
      await Promise.all(
        sorted.map((f, i) => invoke("update_field", { fieldId: f.id, changes: { sort_order: i } }))
      );
    } catch {}
    loadFields();
  };

  const handleLogout = () => { clearSession(); localStorage.removeItem("admin_pw"); navigate("/"); };

  const addEmployee = async () => {
    if (!newEmployeeName.trim()) return;
    try {
      await invoke("create_employee", { name: newEmployeeName.trim(), password: newEmployeePasswordInput.trim() || undefined });
      setNewEmployeeName(""); setNewEmployeePasswordInput("");
      toast.success("Mitarbeiter erstellt"); loadAll();
    } catch (e: any) { toast.error(e.message); }
  };
  const deleteEmployee = async (id: string) => { try { await invoke("delete_employee", { employeeId: id }); toast.success("Gelöscht"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const addCustomer = async () => { if (!newCustomerName.trim()) return; try { await invoke("create_customer", { name: newCustomerName.trim() }); setNewCustomerName(""); toast.success("Kunde erstellt"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const deleteCustomer = async (id: string) => { try { await invoke("delete_customer", { customerId: id }); toast.success("Gelöscht"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const addAssignment = async () => { if (!assignCustomerId || !assignProjectId) return; try { await invoke("create_assignment", { customerId: assignCustomerId, projectId: assignProjectId }); toast.success("Zuweisung erstellt"); setAssignCustomerId(""); setAssignProjectId(""); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const deleteAssignment = async (id: string) => { try { await invoke("delete_assignment", { assignmentId: id }); toast.success("Gelöscht"); loadAll(); } catch (e: any) { toast.error(e.message); } };
  const fieldTypeLabel = (t: string) => ({ text: "Textfeld", textarea: "Textarea", dropdown: "Dropdown", checkbox: "Checkbox" }[t] || t);

  const openPasswordDialog = (emp: any) => { setPasswordDialogEmployee(emp); setDialogPassword(""); };
  const saveEmployeePassword = async () => {
    if (!passwordDialogEmployee || !dialogPassword.trim()) return;
    setSavingEmpPassword(true);
    try {
      await invoke("set_employee_password", { employeeId: passwordDialogEmployee.id, password: dialogPassword.trim() });
      toast.success("Passwort gespeichert");
      setPasswordDialogEmployee(null); setDialogPassword("");
      loadAll();
    } catch (e: any) { toast.error(e.message || "Fehler"); }
    setSavingEmpPassword(false);
  };
  const deleteEmployeePassword = async (empId: string) => {
    try {
      await invoke("delete_employee_password", { employeeId: empId });
      toast.success("Passwort gelöscht");
      loadAll();
    } catch (e: any) { toast.error(e.message || "Fehler"); }
  };

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
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input placeholder="Name des Mitarbeiters" value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEmployee()} />
                    <Input type="password" placeholder="Passwort (optional)" value={newEmployeePasswordInput} onChange={(e) => setNewEmployeePasswordInput(e.target.value)} className="max-w-[180px]" />
                    <Button onClick={addEmployee} disabled={!newEmployeeName.trim()}><Plus className="h-4 w-4 mr-1" /> Hinzufügen</Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {employees.map((emp) => (
                    <div key={emp.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{emp.name}</span>
                        {emp.hasPassword ? (
                          <Badge variant="default" className="text-xs"><Lock className="h-3 w-3 mr-1" />Passwort gesetzt</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Kein Passwort</Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openPasswordDialog(emp)} title="Passwort setzen/ändern"><KeyRound className="h-4 w-4" /></Button>
                        {emp.hasPassword && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" title="Passwort löschen"><Lock className="h-4 w-4 text-amber-500" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Passwort löschen?</AlertDialogTitle>
                                <AlertDialogDescription>Das Passwort von {emp.name} wird entfernt. Der Mitarbeiter kann sich dann ohne Passwort anmelden.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteEmployeePassword(emp.id)}>Löschen</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => deleteEmployee(emp.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                  {employees.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Mitarbeiter</p>}
                </div>
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
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5" /> Admin-Passwort</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Hier kannst du das Admin-Passwort ändern.</p>
                <div className="flex gap-2">
                  <Input type="password" placeholder="Neues Admin-Passwort" value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveAdminPassword()} />
                  <Button onClick={saveAdminPassword} disabled={!newAdminPassword.trim() || savingAdminPassword}>Speichern</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Settings className="h-5 w-5" /> Projekt-Präfix</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Dieses Präfix wird automatisch vor jede neue Projektnummer / Projektname gesetzt.</p>
                <div className="flex gap-2">
                  <Input placeholder="z.B. WER-" value={projectPrefix} onChange={(e) => setProjectPrefix(e.target.value)} />
                  <Button onClick={savePrefix} disabled={savingPrefix}>Speichern</Button>
                </div>
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
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Gilt für</Label>
                                  <Select value={editFieldAppliesTo} onValueChange={setEditFieldAppliesTo}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="all">Alle</SelectItem>
                                      <SelectItem value="aufmass">Nur Aufmaß</SelectItem>
                                      <SelectItem value="aufmass_mit_plan">Nur Aufmaß mit Plan</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex items-center gap-2 pt-5">
                                  <Checkbox id={`edit-required-${field.id}`} checked={editFieldRequired} onCheckedChange={(c) => setEditFieldRequired(!!c)} />
                                  <Label htmlFor={`edit-required-${field.id}`} className="text-sm cursor-pointer">Pflichtfeld</Label>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{field.field_label}</span>
                                <Badge variant="outline" className="text-xs">{fieldTypeLabel(field.field_type)}</Badge>
                                {field.is_required && <Badge variant="default" className="text-xs">Pflichtfeld</Badge>}
                                {field.applies_to && field.applies_to !== "all" && (
                                  <Badge variant="secondary" className="text-xs">{APPLIES_TO_LABELS[field.applies_to] || field.applies_to}</Badge>
                                )}
                                {!field.is_active && <Badge variant="secondary" className="text-xs">Intern ausgeblendet</Badge>}
                                {!field.customer_visible && <Badge variant="secondary" className="text-xs">Für Kunden ausgeblendet</Badge>}
                              </div>
                              {field.field_options && (() => { try { return <p className="text-xs text-muted-foreground mt-0.5 truncate">Optionen: {JSON.parse(field.field_options).join(", ")}</p>; } catch { return null; } })()}
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Gilt für</Label>
                      <Select value={newFieldAppliesTo} onValueChange={setNewFieldAppliesTo}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alle</SelectItem>
                          <SelectItem value="aufmass">Nur Aufmaß</SelectItem>
                          <SelectItem value="aufmass_mit_plan">Nur Aufmaß mit Plan</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <Checkbox id="new-field-required" checked={newFieldRequired} onCheckedChange={(c) => setNewFieldRequired(!!c)} />
                      <Label htmlFor="new-field-required" className="text-sm cursor-pointer">Pflichtfeld</Label>
                    </div>
                  </div>
                  <Button onClick={addField} disabled={!newFieldLabel.trim() || savingField} size="sm"><Plus className="h-4 w-4 mr-1" /> Feld hinzufügen</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Employee password dialog */}
      <Dialog open={!!passwordDialogEmployee} onOpenChange={(open) => { if (!open) setPasswordDialogEmployee(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passwort {passwordDialogEmployee?.hasPassword ? "ändern" : "setzen"}</DialogTitle>
            <DialogDescription>
              {passwordDialogEmployee?.hasPassword
                ? `Neues Passwort für ${passwordDialogEmployee?.name} eingeben.`
                : `Passwort für ${passwordDialogEmployee?.name} festlegen.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="emp-dialog-pw">Neues Passwort</Label>
            <Input id="emp-dialog-pw" type="password" value={dialogPassword} onChange={(e) => setDialogPassword(e.target.value)}
              placeholder="Passwort eingeben" autoFocus onKeyDown={(e) => e.key === "Enter" && saveEmployeePassword()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogEmployee(null)}>Abbrechen</Button>
            <Button onClick={saveEmployeePassword} disabled={!dialogPassword.trim() || savingEmpPassword}>
              {savingEmpPassword ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;
