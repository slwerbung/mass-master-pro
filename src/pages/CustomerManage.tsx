import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Copy, Check, Link, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getSession } from "@/lib/session";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { indexedDBStorage } from "@/lib/indexedDBStorage";

const CustomerManage = () => {
  const navigate = useNavigate();
  const session = getSession();

  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; projectNumber: string }[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [assignProjectId, setAssignProjectId] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const customerLoginUrl = `${window.location.origin}/kunde`;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load customers from Supabase
      const { data: custData } = await supabase.from("customers").select("id, name").order("name");
      setCustomers(custData || []);

      // Load projects from Supabase + local cache (scoped to current employee/admin)
      const localProjects = await indexedDBStorage.getProjects(session);
      let remoteProjects: { id: string; projectNumber: string }[] = [];
      if (session?.role === 'employee') {
        const [{ data: ownedProjects }, { data: extraAssignments }] = await Promise.all([
          supabase.from('projects').select('id, project_number').eq('employee_id', session.id),
          (supabase as any).from('project_employee_assignments').select('project_id').eq('employee_id', session.id),
        ]);
        const assignedIds = Array.from(new Set(((extraAssignments || []) as any[]).map((row) => row.project_id).filter(Boolean)));
        let assignedProjects: any[] = [];
        if (assignedIds.length > 0) {
          const { data } = await supabase.from('projects').select('id, project_number').in('id', assignedIds);
          assignedProjects = data || [];
        }
        remoteProjects = [...(ownedProjects || []), ...assignedProjects].map((project: any) => ({ id: project.id, projectNumber: project.project_number }));
      } else {
        const { data } = await supabase.from('projects').select('id, project_number').order('project_number');
        remoteProjects = (data || []).map((project: any) => ({ id: project.id, projectNumber: project.project_number }));
      }
      const mergedProjects = new Map<string, { id: string; projectNumber: string }>();
      for (const project of remoteProjects) mergedProjects.set(project.id, project);
      for (const project of localProjects.map((p) => ({ id: p.id, projectNumber: p.projectNumber }))) {
        if (!mergedProjects.has(project.id)) mergedProjects.set(project.id, project);
      }
      setProjects(Array.from(mergedProjects.values()).sort((a, b) => a.projectNumber.localeCompare(b.projectNumber, 'de')));

      // Load assignments from Supabase
      const { data: assignData } = await supabase
        .from("customer_project_assignments")
        .select("id, customer_id, project_id, customers(name), projects(project_number)")
        .order("created_at");
      
      // Enrich assignments with local project info
      const enriched = (assignData || []).map((a: any) => {
        const proj = localProjects.find(p => p.id === a.project_id);
        return { ...a, projectNumber: proj?.projectNumber || (a as any).projects?.project_number || a.project_id.slice(0, 8) };
      });
      setAssignments(enriched);
    } catch {
      toast.error("Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session || (session.role !== "employee" && session.role !== "admin")) { navigate("/"); return; }
    loadData();
  }, []);

  const addCustomer = async () => {
    if (!newCustomerName.trim()) return;
    const { error } = await supabase.from("customers").insert({ name: newCustomerName.trim() });
    if (error) { toast.error(error.message.includes("unique") ? "Kunde existiert bereits" : "Fehler beim Erstellen"); return; }
    setNewCustomerName("");
    toast.success("Kunde angelegt");
    loadData();
  };

  const addAssignment = async () => {
    if (!assignCustomerId || !assignProjectId) return;
    // First ensure project exists in Supabase directly (RLS disabled)
    const proj = projects.find(p => p.id === assignProjectId);
    if (proj) {
      // Check if project already exists remotely to preserve existing owner
      const { data: existingProj } = await supabase.from("projects").select("employee_id, user_id").eq("id", proj.id).maybeSingle();
      const employeeId = existingProj?.employee_id ?? (session?.role === "employee" ? session.id : null);
      const userId = existingProj?.user_id ?? (session?.role === "employee" ? session.id : proj.id);
      await supabase.from("projects").upsert({
        id: proj.id,
        project_number: proj.projectNumber,
        user_id: userId,
        employee_id: employeeId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
    }
    const { error } = await supabase.from("customer_project_assignments").insert({ customer_id: assignCustomerId, project_id: assignProjectId });
    if (error) {
      if (error.message.includes("unique")) toast.error("Zuweisung existiert bereits");
      else if (error.message.includes("foreign key")) toast.error("Projekt konnte nicht synchronisiert werden. Bitte nochmals versuchen.");
      else toast.error("Fehler: " + error.message);
      return;
    }
    toast.success("Projekt zugewiesen");
    setAssignCustomerId(""); setAssignProjectId("");
    loadData();
  };

  const deleteAssignment = async (id: string) => {
    const { error } = await supabase.from("customer_project_assignments").delete().eq("id", id);
    if (error) { toast.error("Fehler beim Löschen"); return; }
    toast.success("Zuweisung gelöscht");
    loadData();
  };

  const copyLink = async (id: string) => {
    await navigator.clipboard.writeText(customerLoginUrl);
    setCopiedId(id);
    toast.success("Link kopiert!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Laden...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}><ArrowLeft className="h-4 w-4 mr-1" /> Zurück</Button>
          <div><h1 className="text-2xl font-bold">Kunden verwalten</h1><p className="text-sm text-muted-foreground">Kunden anlegen & Projekte zuweisen</p></div>
        </div>

        {/* Kunden-Login-Link */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Link className="h-4 w-4" /> Kunden-Zugang – Link zum Teilen</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-background border rounded px-3 py-2 truncate">{customerLoginUrl}</code>
              <Button size="sm" variant="outline" onClick={() => copyLink("main")}>
                {copiedId === "main" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Schick diesen Link an deinen Kunden. Er kann sich dort mit seinem Namen anmelden.</p>
          </CardContent>
        </Card>

        {/* Neuen Kunden anlegen */}
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5" /> Neuen Kunden anlegen</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Name des Kunden" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomer()} />
              <Button onClick={addCustomer} disabled={!newCustomerName.trim()}><Plus className="h-4 w-4 mr-1" /> Anlegen</Button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {customers.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-muted rounded-lg text-sm">
                  <span>{c.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => copyLink(c.id)} title="Link kopieren">
                    {copiedId === c.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              ))}
              {customers.length === 0 && <p className="text-muted-foreground text-sm text-center py-3">Noch keine Kunden</p>}
            </div>
          </CardContent>
        </Card>

        {/* Projekt zuweisen */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Projekt zuweisen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Kunde</Label>
                <Select value={assignCustomerId} onValueChange={setAssignCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Kunde wählen" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Projekt</Label>
                <Select value={assignProjectId} onValueChange={setAssignProjectId}>
                  <SelectTrigger><SelectValue placeholder="Projekt wählen" /></SelectTrigger>
                  <SelectContent>
                    {projects.length === 0
                      ? <SelectItem value="_none" disabled>Keine lokalen Projekte</SelectItem>
                      : projects.map((p) => <SelectItem key={p.id} value={p.id}>Projekt {p.projectNumber}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={addAssignment} disabled={!assignCustomerId || !assignProjectId} className="w-full">
              <Plus className="h-4 w-4 mr-1" /> Zuweisen
            </Button>

            {/* Bestehende Zuweisungen */}
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Aktuelle Zuweisungen</p>
              {assignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                  <span>
                    <span className="font-medium">{(a.customers as any)?.name}</span>{" → "}
                    <span className="font-medium">Projekt {a.projectNumber}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => deleteAssignment(a.id)} title="Zuweisung löschen">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
              {assignments.length === 0 && <p className="text-muted-foreground text-sm text-center py-2">Noch keine Zuweisungen</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CustomerManage;
