import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { LogOut, Plus, Trash2, User, Users, FolderOpen, Link, Settings, Lock, ChevronDown, ChevronUp, Pencil, Save, X, KeyRound, ImageIcon, Car, Plug, CheckCircle, XCircle } from "lucide-react";
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
  fahrzeugbeschriftung: "Nur Fahrzeug",
};

const Admin = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [projectEmployeeAssignments, setProjectEmployeeAssignments] = useState<any[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeePasswordInput, setNewEmployeePasswordInput] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [assignProjectId, setAssignProjectId] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [selectedProjectAccessId, setSelectedProjectAccessId] = useState("");
  const [selectedProjectOwnerId, setSelectedProjectOwnerId] = useState("__none__");
  const [selectedAdditionalEmployeeId, setSelectedAdditionalEmployeeId] = useState("");
  const [savingAdminPassword, setSavingAdminPassword] = useState(false);
  const [projectPrefix, setProjectPrefix] = useState("");
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [projectFields, setProjectFields] = useState<FieldConfig[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newProjectFieldLabel, setNewProjectFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldConfig["field_type"]>("text");
  const [newProjectFieldType, setNewProjectFieldType] = useState<FieldConfig["field_type"]>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [newProjectFieldOptions, setNewProjectFieldOptions] = useState("");
  const [newFieldAppliesTo, setNewFieldAppliesTo] = useState("all");
  const [newProjectFieldAppliesTo, setNewProjectFieldAppliesTo] = useState("all");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newProjectFieldRequired, setNewProjectFieldRequired] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingProjectFieldId, setEditingProjectFieldId] = useState<string | null>(null);
  const [editFieldLabel, setEditFieldLabel] = useState("");
  const [editProjectFieldLabel, setEditProjectFieldLabel] = useState("");
  const [editFieldType, setEditFieldType] = useState<FieldConfig["field_type"]>("text");
  const [editProjectFieldType, setEditProjectFieldType] = useState<FieldConfig["field_type"]>("text");
  const [editFieldOptions, setEditFieldOptions] = useState("");
  const [editProjectFieldOptions, setEditProjectFieldOptions] = useState("");
  const [editFieldAppliesTo, setEditFieldAppliesTo] = useState("all");
  const [editProjectFieldAppliesTo, setEditProjectFieldAppliesTo] = useState("all");
  const [editFieldRequired, setEditFieldRequired] = useState(false);
  const [editProjectFieldRequired, setEditProjectFieldRequired] = useState(false);
  // Integration state
  const [heroApiKey, setHeroApiKey] = useState("");
  const [heroEnabled, setHeroEnabled] = useState(false);
  const [heroHasKey, setHeroHasKey] = useState(false);
  const [savingHero, setSavingHero] = useState(false);
  const [testingHero, setTestingHero] = useState(false);
  const [heroTestResult, setHeroTestResult] = useState<{ok: boolean; msg: string} | null>(null);

  const [vehicleFields, setVehicleFields] = useState<FieldConfig[]>([]);
  const [newVehicleFieldLabel, setNewVehicleFieldLabel] = useState("");
  const [newVehicleFieldType, setNewVehicleFieldType] = useState<FieldConfig["field_type"]>("text");
  const [newVehicleFieldOptions, setNewVehicleFieldOptions] = useState("");
  const [newVehicleFieldRequired, setNewVehicleFieldRequired] = useState(false);
  const [editingVehicleFieldId, setEditingVehicleFieldId] = useState<string | null>(null);
  const [editVehicleFieldLabel, setEditVehicleFieldLabel] = useState("");
  const [editVehicleFieldType, setEditVehicleFieldType] = useState<FieldConfig["field_type"]>("text");
  const [editVehicleFieldOptions, setEditVehicleFieldOptions] = useState("");
  const [editVehicleFieldRequired, setEditVehicleFieldRequired] = useState(false);
  // Employee password dialog
  const [passwordDialogEmployee, setPasswordDialogEmployee] = useState<any | null>(null);
  const [dialogPassword, setDialogPassword] = useState("");
  const [savingEmpPassword, setSavingEmpPassword] = useState(false);
  const [viewSettings, setViewSettings] = useState({
    internalShowPrintFiles: true,
    customerShowPrintFiles: true,
    internalShowDetailImages: true,
    customerShowDetailImages: false,
  });
  const [savingViewSettings, setSavingViewSettings] = useState(false);

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
    if (adminToken) { loadAll(); loadFields(); loadProjectFields(); loadPrefix(); loadViewSettings(); loadLogo(); loadVehicleFields(); loadIntegrations(); }
  }, [adminToken]);

  useEffect(() => {
    if (!selectedProjectAccessId) return;
    const project = projects.find((entry) => entry.id === selectedProjectAccessId);
    if (project) {
      setSelectedProjectOwnerId(project.employee_id || '__none__');
    }
  }, [selectedProjectAccessId, projects]);

  const loadAll = useCallback(async () => {
    try {
      const [empRes, custRes, projRes, assignRes, projectEmpAssignRes] = await Promise.all([
        invoke("list_employees"), invoke("list_customers"), invoke("list_projects"), invoke("list_assignments"), invoke("list_project_employee_assignments"),
      ]);
      setEmployees(empRes.employees || []);
      setCustomers(custRes.customers || []);
      setProjects(projRes.projects || []);
      setAssignments(assignRes.assignments || []);
      setProjectEmployeeAssignments(projectEmpAssignRes.assignments || []);
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

  const loadLogo = async () => {
    try {
      const data = await invoke("get_logo");
      setCompanyLogo(data?.logo ?? null);
    } catch {}
  };

  const saveLogo = async (logoData: string | null) => {
    setSavingLogo(true);
    try {
      await invoke("set_logo", { logoData });
      setCompanyLogo(logoData);
      toast.success(logoData ? "Logo gespeichert" : "Logo gelöscht");
    } catch (e: any) { toast.error(e.message || "Fehler beim Speichern"); }
    setSavingLogo(false);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { toast.error("Logo zu groß (max. 1.5 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => saveLogo(reader.result as string);
    reader.readAsDataURL(file);
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


  const loadProjectFields = async () => {
    try {
      const data = await invoke("list_project_fields");
      setProjectFields((data.fields || []) as FieldConfig[]);
    } catch {
      // Fallback: direct read (read-only, no write risk)
      const { data } = await supabase.from("project_field_config").select("*").order("sort_order");
      setProjectFields((data || []) as FieldConfig[]);
    }
  };

  const addProjectField = async () => {
    if (!newProjectFieldLabel.trim()) return;
    const maxOrder = projectFields.length > 0 ? Math.max(...projectFields.map(f => f.sort_order)) + 1 : 0;
    try {
      await invoke("create_project_field", {
        fieldKey: `custom_${Date.now()}`,
        fieldLabel: newProjectFieldLabel.trim(),
        fieldType: newProjectFieldType,
        fieldOptions: newProjectFieldType === "dropdown" && newProjectFieldOptions.trim()
          ? newProjectFieldOptions.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        sortOrder: maxOrder,
        appliesTo: newProjectFieldAppliesTo,
        isRequired: newProjectFieldRequired,
      });
      setNewProjectFieldLabel(""); setNewProjectFieldOptions(""); setNewProjectFieldType("text"); setNewProjectFieldAppliesTo("all"); setNewProjectFieldRequired(false);
      toast.success("Projektfeld erstellt"); loadProjectFields();
    } catch (e: any) { toast.error(e.message || "Fehler beim Erstellen"); }
  };

  const startEditProjectField = (field: FieldConfig) => {
    setEditingProjectFieldId(field.id);
    setEditProjectFieldLabel(field.field_label);
    setEditProjectFieldType(field.field_type);
    setEditProjectFieldAppliesTo(field.applies_to || "all");
    setEditProjectFieldRequired(field.is_required ?? false);
    try { const parsed = field.field_options ? JSON.parse(field.field_options) : []; setEditProjectFieldOptions(Array.isArray(parsed) ? parsed.join(", ") : ""); } catch { setEditProjectFieldOptions(""); }
  };

  const cancelEditProjectField = () => {
    setEditingProjectFieldId(null); setEditProjectFieldLabel(""); setEditProjectFieldType("text"); setEditProjectFieldOptions(""); setEditProjectFieldAppliesTo("all"); setEditProjectFieldRequired(false);
  };

  const saveProjectFieldEdit = async (field: FieldConfig) => {
    const changes: any = {
      field_label: editProjectFieldLabel.trim() || field.field_label,
      field_type: editProjectFieldType,
      field_options: editProjectFieldType === "dropdown" && editProjectFieldOptions.trim()
        ? JSON.stringify(editProjectFieldOptions.split(",").map((s: string) => s.trim()).filter(Boolean)) : null,
      applies_to: editProjectFieldAppliesTo,
      is_required: editProjectFieldRequired,
    };
    try {
      await invoke("update_project_field", { fieldId: field.id, changes });
      cancelEditProjectField(); loadProjectFields(); toast.success("Projektfeld aktualisiert");
    } catch (e: any) { toast.error(e.message || "Fehler beim Speichern"); }
  };

  const toggleProjectField = async (field: FieldConfig) => {
    try { await invoke("update_project_field", { fieldId: field.id, changes: { is_active: !field.is_active } }); } catch {}
    loadProjectFields();
  };

  const deleteProjectField = async (id: string) => {
    try { await invoke("delete_project_field", { fieldId: id }); } catch {}
    loadProjectFields(); toast.success("Projektfeld gelöscht");
  };

  const loadIntegrations = async () => {
    try {
      const data = await invoke("get_integration_config");
      setHeroEnabled(data?.hero?.enabled ?? false);
      setHeroHasKey(data?.hero?.hasKey ?? false);
    } catch {}
  };

  const saveHeroConfig = async () => {
    setSavingHero(true);
    setHeroTestResult(null);
    try {
      await invoke("set_integration_config", {
        heroApiKey: heroApiKey.trim() || undefined,
        heroEnabled,
      });
      toast.success("HERO Einstellungen gespeichert");
      setHeroApiKey(""); // clear after save
      await loadIntegrations();
    } catch (e: any) { toast.error(e.message || "Fehler"); }
    finally { setSavingHero(false); }
  };

  const testHeroConnection = async () => {
    setTestingHero(true);
    setHeroTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-manage", {
        body: { adminToken, action: "test_hero_connection" },
      });
      const payload = data || {};
      if (payload.success) {
        setHeroTestResult({ ok: true, msg: payload.message || "Verbindung erfolgreich ✓" });
      } else {
        setHeroTestResult({ ok: false, msg: payload.error || error?.message || "Verbindung fehlgeschlagen" });
      }
    } catch (e: any) {
      setHeroTestResult({ ok: false, msg: e.message || "Unbekannter Fehler" });
    }
    finally { setTestingHero(false); }
  };

  const loadVehicleFields = async () => {
    const { data } = await supabase.from("vehicle_field_config").select("*").order("sort_order");
    setVehicleFields((data || []) as FieldConfig[]);
  };

  const addVehicleField = async () => {
    if (!newVehicleFieldLabel.trim()) return;
    const maxOrder = vehicleFields.length > 0 ? Math.max(...vehicleFields.map(f => f.sort_order)) + 1 : 0;
    const key = `vfield_${Date.now()}`;
    const { error } = await supabase.from("vehicle_field_config").insert({
      field_key: key,
      field_label: newVehicleFieldLabel.trim(),
      field_type: newVehicleFieldType,
      field_options: newVehicleFieldType === "dropdown" && newVehicleFieldOptions.trim()
        ? JSON.stringify(newVehicleFieldOptions.split(",").map((s: string) => s.trim()).filter(Boolean)) : null,
      sort_order: maxOrder,
      is_required: newVehicleFieldRequired,
    });
    if (error) { toast.error("Fehler beim Erstellen: " + error.message); return; }
    setNewVehicleFieldLabel(""); setNewVehicleFieldOptions(""); setNewVehicleFieldType("text"); setNewVehicleFieldRequired(false);
    toast.success("Fahrzeugfeld erstellt"); loadVehicleFields();
  };

  const startEditVehicleField = (field: FieldConfig) => {
    setEditingVehicleFieldId(field.id);
    setEditVehicleFieldLabel(field.field_label);
    setEditVehicleFieldType(field.field_type);
    setEditVehicleFieldRequired(field.is_required ?? false);
    try { const parsed = field.field_options ? JSON.parse(field.field_options) : []; setEditVehicleFieldOptions(Array.isArray(parsed) ? parsed.join(", ") : ""); } catch { setEditVehicleFieldOptions(""); }
  };

  const cancelEditVehicleField = () => {
    setEditingVehicleFieldId(null); setEditVehicleFieldLabel(""); setEditVehicleFieldType("text"); setEditVehicleFieldOptions(""); setEditVehicleFieldRequired(false);
  };

  const saveVehicleFieldEdit = async (field: FieldConfig) => {
    const { error } = await supabase.from("vehicle_field_config").update({
      field_label: editVehicleFieldLabel.trim() || field.field_label,
      field_type: editVehicleFieldType,
      field_options: editVehicleFieldType === "dropdown" && editVehicleFieldOptions.trim()
        ? JSON.stringify(editVehicleFieldOptions.split(",").map((s: string) => s.trim()).filter(Boolean)) : null,
      is_required: editVehicleFieldRequired,
    }).eq("id", field.id);
    if (error) { toast.error("Fehler beim Speichern"); return; }
    cancelEditVehicleField(); loadVehicleFields(); toast.success("Fahrzeugfeld aktualisiert");
  };

  const toggleVehicleField = async (field: FieldConfig) => {
    await supabase.from("vehicle_field_config").update({ is_active: !field.is_active }).eq("id", field.id);
    loadVehicleFields();
  };

  const deleteVehicleField = async (id: string) => {
    await supabase.from("vehicle_field_config").delete().eq("id", id);
    loadVehicleFields(); toast.success("Fahrzeugfeld gelöscht");
  };

  const loadViewSettings = async () => {
    try {
      const data = await invoke("get_view_settings");
      if (data?.settings) setViewSettings(data.settings);
    } catch {}
  };

  const saveViewSettings = async () => {
    setSavingViewSettings(true);
    try {
      await invoke("set_view_settings", { settings: viewSettings });
      toast.success("Medien-Sichtbarkeit gespeichert");
    } catch (e: any) {
      toast.error(e.message || "Fehler beim Speichern");
    }
    setSavingViewSettings(false);
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
    // Only update the 2 affected fields (was updating all N fields)
    const orderA = sorted[idx].sort_order;
    const orderB = sorted[swapIdx].sort_order;
    try {
      await Promise.all([
        invoke("update_field", { fieldId: sorted[idx].id, changes: { sort_order: orderB } }),
        invoke("update_field", { fieldId: sorted[swapIdx].id, changes: { sort_order: orderA } }),
      ]);
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

  const selectedProject = projects.find((project) => project.id === selectedProjectAccessId) || null;
  const selectedProjectAssignments = projectEmployeeAssignments.filter((assignment) => assignment.project_id === selectedProjectAccessId);

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectAccessId(projectId);
    const project = projects.find((entry) => entry.id === projectId);
    setSelectedProjectOwnerId(project?.employee_id || '__none__');
    setSelectedAdditionalEmployeeId('');
  };

  const saveProjectOwner = async () => {
    if (!selectedProjectAccessId) return;
    try {
      await invoke('set_project_employee_owner', {
        projectId: selectedProjectAccessId,
        employeeId: selectedProjectOwnerId === '__none__' ? null : selectedProjectOwnerId,
      });
      toast.success('Hauptzuständigkeit gespeichert');
      loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Fehler');
    }
  };

  const addProjectEmployeeAssignment = async () => {
    if (!selectedProjectAccessId || !selectedAdditionalEmployeeId) return;
    try {
      await invoke('create_project_employee_assignment', { projectId: selectedProjectAccessId, employeeId: selectedAdditionalEmployeeId });
      toast.success('Zusätzlicher Mitarbeiter zugeordnet');
      setSelectedAdditionalEmployeeId('');
      loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Fehler');
    }
  };

  const removeProjectEmployeeAssignment = async (assignmentId: string) => {
    try {
      await invoke('delete_project_employee_assignment', { assignmentId });
      toast.success('Zusätzliche Zuordnung entfernt');
      loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Fehler');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl md:text-3xl font-bold">Admin-Bereich</h1><p className="text-muted-foreground text-sm">Verwaltung</p></div>
          <Button variant="outline" onClick={handleLogout}><LogOut className="h-4 w-4 mr-1" /> Abmelden</Button>
        </div>
        <Tabs defaultValue="employees">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-7 h-auto">
            <TabsTrigger value="employees" className="text-xs sm:text-sm">Mitarbeiter</TabsTrigger>
            <TabsTrigger value="customers" className="text-xs sm:text-sm">Kunden</TabsTrigger>
            <TabsTrigger value="assignments" className="text-xs sm:text-sm">Zuweisungen</TabsTrigger>
            <TabsTrigger value="projects" className="text-xs sm:text-sm">Projekte</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs sm:text-sm">Einstellungen</TabsTrigger>
            <TabsTrigger value="vehicle" className="text-xs sm:text-sm">Fahrzeug</TabsTrigger>
            <TabsTrigger value="integrations" className="text-xs sm:text-sm">Integrationen</TabsTrigger>
          </TabsList>

          <TabsContent value="employees" className="space-y-4 mt-4">
            <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5" /> Mitarbeiter verwalten</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder="Name des Mitarbeiters" value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEmployee()} />
                    <Input type="password" placeholder="Passwort (optional)" value={newEmployeePasswordInput} onChange={(e) => setNewEmployeePasswordInput(e.target.value)} className="sm:max-w-[180px]" />
                    <Button onClick={addEmployee} disabled={!newEmployeeName.trim()} className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-1" /> Hinzufügen</Button>
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

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Settings className="h-5 w-5" /> Projektfelder konfigurieren</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Diese Felder werden beim Anlegen eines Projekts abgefragt und anschließend in Projektinfos / PDF angezeigt.</p>
                <div className="space-y-2">
                  {projectFields.map((field) => {
                    const isEditing = editingProjectFieldId === field.id;
                    return (
                      <div key={field.id || field.field_key} className={`p-3 rounded-lg border space-y-3 ${field.is_active ? "bg-background" : "bg-muted opacity-60"}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            {isEditing ? (
                              <div className="space-y-2">
                                <Input value={editProjectFieldLabel} onChange={(e) => setEditProjectFieldLabel(e.target.value)} placeholder="Feldbezeichnung" />
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <Select value={editProjectFieldType} onValueChange={(v) => setEditProjectFieldType(v as FieldConfig["field_type"])}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="text">Textfeld</SelectItem>
                                      <SelectItem value="textarea">Textarea</SelectItem>
                                      <SelectItem value="dropdown">Dropdown</SelectItem>
                                      <SelectItem value="checkbox">Checkbox</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {editProjectFieldType === "dropdown" ? <Input value={editProjectFieldOptions} onChange={(e) => setEditProjectFieldOptions(e.target.value)} placeholder="Optionen, kommagetrennt" /> : <div />}
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <Select value={editProjectFieldAppliesTo} onValueChange={setEditProjectFieldAppliesTo}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="all">Alle</SelectItem>
                                      <SelectItem value="aufmass">Nur Aufmaß</SelectItem>
                                      <SelectItem value="aufmass_mit_plan">Nur Aufmaß mit Plan</SelectItem>
                                      <SelectItem value="fahrzeugbeschriftung">Nur Fahrzeug</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <div className="flex items-center gap-2 pt-2"><Checkbox checked={editProjectFieldRequired} onCheckedChange={(c) => setEditProjectFieldRequired(!!c)} /><Label className="text-sm">Pflichtfeld</Label></div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{field.field_label}</span>
                                <Badge variant="outline" className="text-xs">{fieldTypeLabel(field.field_type)}</Badge>
                                {field.is_required && <Badge variant="default" className="text-xs">Pflichtfeld</Badge>}
                                {!field.is_active && <Badge variant="secondary" className="text-xs">Ausgeblendet</Badge>}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {isEditing ? (
                              <><Button variant="ghost" size="sm" onClick={() => saveProjectFieldEdit(field)}><Save className="h-4 w-4" /></Button><Button variant="ghost" size="sm" onClick={cancelEditProjectField}><X className="h-4 w-4" /></Button></>
                            ) : (
                              <><Button variant="ghost" size="sm" onClick={() => startEditProjectField(field)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="sm" onClick={() => field.id && deleteProjectField(field.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between rounded border px-3 py-2">
                          <div><p className="text-sm font-medium">Beim Projekt anlegen sichtbar</p></div>
                          <Switch checked={field.is_active} onCheckedChange={() => toggleProjectField(field)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                  <p className="text-sm font-medium">Neues Projektfeld hinzufügen</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Bezeichnung</Label><Input value={newProjectFieldLabel} onChange={(e) => setNewProjectFieldLabel(e.target.value)} /></div>
                    <div className="space-y-1"><Label className="text-xs">Feldtyp</Label><Select value={newProjectFieldType} onValueChange={(v) => setNewProjectFieldType(v as FieldConfig["field_type"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Textfeld</SelectItem><SelectItem value="textarea">Textarea</SelectItem><SelectItem value="dropdown">Dropdown</SelectItem><SelectItem value="checkbox">Checkbox</SelectItem></SelectContent></Select></div>
                  </div>
                  {newProjectFieldType === "dropdown" && <div className="space-y-1"><Label className="text-xs">Optionen</Label><Input value={newProjectFieldOptions} onChange={(e) => setNewProjectFieldOptions(e.target.value)} /></div>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Gilt für</Label><Select value={newProjectFieldAppliesTo} onValueChange={setNewProjectFieldAppliesTo}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle</SelectItem><SelectItem value="aufmass">Nur Aufmaß</SelectItem><SelectItem value="aufmass_mit_plan">Nur Aufmaß mit Plan</SelectItem><SelectItem value="fahrzeugbeschriftung">Nur Fahrzeug</SelectItem></SelectContent></Select></div>
                    <div className="flex items-center gap-2 pt-5"><Checkbox checked={newProjectFieldRequired} onCheckedChange={(c) => setNewProjectFieldRequired(!!c)} /><Label className="text-sm">Pflichtfeld</Label></div>
                  </div>
                  <Button onClick={addProjectField} size="sm" disabled={!newProjectFieldLabel.trim()}><Plus className="h-4 w-4 mr-1" /> Projektfeld hinzufügen</Button>
                </div>
              </CardContent>
            </Card>

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
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Projekt-Zuständigkeiten</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Logik: Jedes Projekt hat genau einen Hauptzuständigen. Zusätzlich können weitere Mitarbeiter Zugriff erhalten. So bleibt es übersichtlich und mehrere Mitarbeiter können trotzdem mitarbeiten.</p>
                <div className="space-y-2">
                  {projects.map((project) => {
                    const extraAssignments = projectEmployeeAssignments.filter((assignment) => assignment.project_id === project.id);
                    const isSelected = selectedProjectAccessId === project.id;
                    return (
                      <div key={project.id} className="rounded-lg border bg-muted/40 p-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{project.project_number}</div>
                            <div className="text-sm text-muted-foreground">
                              Hauptzuständig: {project.employees?.name || 'Nicht zugeordnet'}
                              {extraAssignments.length > 0 && <span className="ml-2">· {extraAssignments.length} weitere Mitarbeiter</span>}
                            </div>
                          </div>
                          <Button variant={isSelected ? "secondary" : "outline"} size="sm" onClick={() => {
                            if (isSelected) {
                              setSelectedProjectAccessId("");
                              setSelectedProjectOwnerId("");
                              setSelectedAdditionalEmployeeId("");
                              // selectedProjectAssignments is derived, clearing the ID resets it
                            } else {
                              handleProjectSelect(project.id);
                            }
                          }}>
                            {isSelected ? 'Schließen' : 'Zuweisung bearbeiten'}
                          </Button>
                        </div>

                        {isSelected && (
                          <div className="space-y-4 rounded-lg border bg-background p-4">
                            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                              <div className="space-y-1">
                                <Label className="text-xs">Hauptzuständig</Label>
                                <Select value={selectedProjectOwnerId} onValueChange={setSelectedProjectOwnerId}>
                                  <SelectTrigger><SelectValue placeholder="Mitarbeiter wählen" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Nicht zugeordnet</SelectItem>
                                    {employees.map((emp) => <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-end">
                                <Button onClick={saveProjectOwner}>Speichern</Button>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                              <div className="space-y-1">
                                <Label className="text-xs">Zusätzlichen Mitarbeiter zuordnen</Label>
                                <Select value={selectedAdditionalEmployeeId} onValueChange={setSelectedAdditionalEmployeeId}>
                                  <SelectTrigger><SelectValue placeholder="Mitarbeiter wählen" /></SelectTrigger>
                                  <SelectContent>
                                    {employees
                                      .filter((emp) => emp.id !== project.employee_id && !selectedProjectAssignments.some((assignment) => assignment.employee_id === emp.id))
                                      .map((emp) => <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-end">
                                <Button onClick={addProjectEmployeeAssignment} disabled={!selectedAdditionalEmployeeId}>
                                  <Plus className="h-4 w-4 mr-1" /> Hinzufügen
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zusätzliche Mitarbeiter</p>
                              {selectedProjectAssignments.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Keine zusätzlichen Mitarbeiter zugeordnet.</p>
                              ) : (
                                <div className="space-y-2">
                                  {selectedProjectAssignments.map((assignment) => (
                                    <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-muted p-2 text-sm">
                                      <span>{assignment.employees?.name || assignment.employee_id}</span>
                                      <Button variant="ghost" size="sm" onClick={() => removeProjectEmployeeAssignment(assignment.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {projects.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Projekte</p>}
                </div>
              </CardContent>
            </Card>
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
                  <Button variant="destructive" disabled={savingPrefix || projectPrefix === ""} onClick={async () => {
                    setSavingPrefix(true);
                    try {
                      await invoke("set_project_prefix", { prefix: "" });
                      setProjectPrefix("");
                      toast.success("Präfix gelöscht");
                    } catch (e: any) { toast.error(e.message || "Fehler"); }
                    setSavingPrefix(false);
                  }}>Löschen</Button>
                </div>
                <p className="text-xs text-muted-foreground">Leer lassen oder löschen für keinen Präfix.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Medien-Sichtbarkeit</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Hier legst du fest, ob Druckdateien und Detailbilder in der internen Ansicht, der Kundenansicht und im jeweiligen PDF-Export sichtbar sind.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border p-3 space-y-3">
                    <p className="text-sm font-medium">Interne Ansicht / Interner Export</p>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="internal-print-files">Druckdateien anzeigen</Label>
                      <Switch id="internal-print-files" checked={viewSettings.internalShowPrintFiles} onCheckedChange={(checked) => setViewSettings((prev) => ({ ...prev, internalShowPrintFiles: checked }))} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="internal-detail-images">Detailbilder anzeigen</Label>
                      <Switch id="internal-detail-images" checked={viewSettings.internalShowDetailImages} onCheckedChange={(checked) => setViewSettings((prev) => ({ ...prev, internalShowDetailImages: checked }))} />
                    </div>
                  </div>
                  <div className="rounded-lg border p-3 space-y-3">
                    <p className="text-sm font-medium">Kundenansicht / Kunden-Export</p>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="customer-print-files">Druckdateien anzeigen</Label>
                      <Switch id="customer-print-files" checked={viewSettings.customerShowPrintFiles} onCheckedChange={(checked) => setViewSettings((prev) => ({ ...prev, customerShowPrintFiles: checked }))} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="customer-detail-images">Detailbilder anzeigen</Label>
                      <Switch id="customer-detail-images" checked={viewSettings.customerShowDetailImages} onCheckedChange={(checked) => setViewSettings((prev) => ({ ...prev, customerShowDetailImages: checked }))} />
                    </div>
                  </div>
                </div>
                <Button onClick={saveViewSettings} disabled={savingViewSettings}>{savingViewSettings ? "Speichert..." : "Medien-Sichtbarkeit speichern"}</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Firmenlogo</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Das Logo wird im PDF-Export rechts unten angezeigt. Empfohlen: PNG mit Transparenz, max. 1.5 MB.</p>
                <div className="flex items-center gap-4">
                  {companyLogo && (
                    <div className="border rounded-lg p-2 bg-muted/30 flex items-center justify-center" style={{ width: 80, height: 60 }}>
                      <img src={companyLogo} alt="Firmenlogo" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label className="cursor-pointer">
                      <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={handleLogoUpload} disabled={savingLogo} />
                      <span className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-md bg-background hover:bg-muted transition-colors cursor-pointer">
                        {savingLogo ? "Speichert..." : companyLogo ? "Logo ersetzen" : "Logo hochladen"}
                      </span>
                    </label>
                    {companyLogo && (
                      <Button variant="outline" size="sm" onClick={() => saveLogo(null)} disabled={savingLogo} className="text-destructive hover:text-destructive">
                        Logo löschen
                      </Button>
                    )}
                  </div>
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
                                      <SelectItem value="fahrzeugbeschriftung">Nur Fahrzeug</SelectItem>
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

          <TabsContent value="vehicle" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Car className="h-5 w-5" /> Fahrzeugfelder verwalten</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Diese Felder erscheinen bei Projekten vom Typ "Fahrzeugbeschriftung".</p>
                <div className="space-y-2">
                  {vehicleFields.map((field) => (
                    <div key={field.id} className="p-3 border rounded-lg space-y-2">
                      {editingVehicleFieldId === field.id ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1"><Label className="text-xs">Bezeichnung</Label><Input value={editVehicleFieldLabel} onChange={(e) => setEditVehicleFieldLabel(e.target.value)} /></div>
                          <div className="space-y-1"><Label className="text-xs">Feldtyp</Label>
                            <Select value={editVehicleFieldType} onValueChange={(v) => setEditVehicleFieldType(v as FieldConfig["field_type"])}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">Textfeld</SelectItem>
                                <SelectItem value="textarea">Textarea</SelectItem>
                                <SelectItem value="dropdown">Dropdown</SelectItem>
                                <SelectItem value="checkbox">Checkbox</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {editVehicleFieldType === "dropdown" && <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Optionen (kommagetrennt)</Label><Input value={editVehicleFieldOptions} onChange={(e) => setEditVehicleFieldOptions(e.target.value)} /></div>}
                          <div className="flex items-center gap-2 pt-1"><Checkbox checked={editVehicleFieldRequired} onCheckedChange={(c) => setEditVehicleFieldRequired(!!c)} /><Label className="text-sm">Pflichtfeld</Label></div>
                          <div className="flex gap-2 sm:col-span-2">
                            <Button size="sm" onClick={() => saveVehicleFieldEdit(field)}>Speichern</Button>
                            <Button size="sm" variant="ghost" onClick={cancelEditVehicleField}>Abbrechen</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{field.field_label} <span className="text-xs text-muted-foreground">({field.field_type}){field.is_required ? " *" : ""}</span></p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="sm" onClick={() => toggleVehicleField(field)} className={field.is_active ? "text-green-600" : "text-muted-foreground"}>{field.is_active ? "Aktiv" : "Inaktiv"}</Button>
                            <Button variant="ghost" size="sm" onClick={() => startEditVehicleField(field)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteVehicleField(field.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {vehicleFields.length === 0 && <p className="text-muted-foreground text-center py-4">Noch keine Fahrzeugfelder definiert</p>}
                </div>
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium">Neues Fahrzeugfeld</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Bezeichnung</Label><Input value={newVehicleFieldLabel} onChange={(e) => setNewVehicleFieldLabel(e.target.value)} /></div>
                    <div className="space-y-1"><Label className="text-xs">Feldtyp</Label>
                      <Select value={newVehicleFieldType} onValueChange={(v) => setNewVehicleFieldType(v as FieldConfig["field_type"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Textfeld</SelectItem>
                          <SelectItem value="textarea">Textarea</SelectItem>
                          <SelectItem value="dropdown">Dropdown</SelectItem>
                          <SelectItem value="checkbox">Checkbox</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {newVehicleFieldType === "dropdown" && <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Optionen (kommagetrennt)</Label><Input value={newVehicleFieldOptions} onChange={(e) => setNewVehicleFieldOptions(e.target.value)} /></div>}
                    <div className="flex items-center gap-2 pt-1"><Checkbox checked={newVehicleFieldRequired} onCheckedChange={(c) => setNewVehicleFieldRequired(!!c)} /><Label className="text-sm">Pflichtfeld</Label></div>
                  </div>
                  <Button onClick={addVehicleField} size="sm" disabled={!newVehicleFieldLabel.trim()}><Plus className="h-4 w-4 mr-1" /> Fahrzeugfeld hinzufügen</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="integrations" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Plug className="h-5 w-5" /> HERO Software Integration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Verbinde die App mit deiner HERO Handwerkersoftware. Mit einem API Key können Projekte aus HERO gesucht und Kundendaten automatisch übernommen werden.
                </p>

                <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                  <div className="flex-1">
                    <p className="text-sm font-medium">Status</p>
                    <p className="text-xs text-muted-foreground">{heroHasKey ? (heroEnabled ? "Aktiv" : "Key hinterlegt, aber deaktiviert") : "Kein API Key hinterlegt"}</p>
                  </div>
                  <div className={`h-3 w-3 rounded-full ${heroEnabled && heroHasKey ? "bg-green-500" : "bg-muted-foreground"}`} />
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder={heroHasKey ? "●●●●●●●●●●●● (gespeichert)" : "Bearer Token eingeben"}
                        value={heroApiKey}
                        onChange={e => setHeroApiKey(e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Den API Key erhältst du vom HERO Support. Er wird verschlüsselt gespeichert und nie im Frontend angezeigt.</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox checked={heroEnabled} onCheckedChange={c => setHeroEnabled(!!c)} />
                    <Label className="text-sm cursor-pointer" onClick={() => setHeroEnabled(v => !v)}>Integration aktivieren</Label>
                  </div>

                  {heroTestResult && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${heroTestResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                      {heroTestResult.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                      {heroTestResult.msg}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={saveHeroConfig} disabled={savingHero}>
                      {savingHero ? "Speichert..." : "Speichern"}
                    </Button>
                    {heroHasKey && (
                      <Button variant="outline" onClick={testHeroConnection} disabled={testingHero}>
                        {testingHero ? "Teste..." : "Verbindung testen"}
                      </Button>
                    )}
                    {heroHasKey && (
                      <Button variant="ghost" size="sm" onClick={async () => {
                        const session = getSession();
                        const { data } = await supabase.functions.invoke("hero-integration", {
                          body: { action: "debug_query", sessionToken: session?.authToken || "valid" },
                        });
                        toast.info("Debug: " + JSON.stringify(data).slice(0, 300));
                        console.log("HERO debug:", data);
                      }}>
                        Debug
                      </Button>
                    )}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Verfügbare Funktionen</p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>✓ Beim Anlegen eines Projekts: HERO-Projekt suchen und Kundendaten übernehmen</p>
                    <p className="text-muted-foreground/60">◌ Weitere Funktionen folgen</p>
                  </div>
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
