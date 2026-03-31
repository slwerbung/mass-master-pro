import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Ruler, Map } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { mergeWithDefaultProjectFields, type ProjectFieldConfig } from "@/lib/projectFields";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";

const NewProject = () => {
  const [projectNumber, setProjectNumber] = useState("");
  const [projectType, setProjectType] = useState<'aufmass' | 'aufmass_mit_plan'>('aufmass');
  const [isCreating, setIsCreating] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [allProjectFieldConfigs, setAllProjectFieldConfigs] = useState<ProjectFieldConfig[]>([]);
  const [projectFieldConfigs, setProjectFieldConfigs] = useState<ProjectFieldConfig[]>([]);
  const [projectFieldValues, setProjectFieldValues] = useState<Record<string, any>>({});
  const navigate = useNavigate();

  useEffect(() => {
    const session = getSession();
    const tokenBody: Record<string, string> = { action: "get_project_prefix" };
    if (session?.authToken) {
      if (session.role === "admin") tokenBody.adminToken = session.authToken;
      else tokenBody.employeeToken = session.authToken;
    }
    supabase.functions.invoke("admin-manage", {
      body: tokenBody,
    }).then(({ data }) => {
      if (data?.prefix !== undefined) setPrefix(data.prefix);
    }).catch(() => {});

    supabase.from("project_field_config").select("*").order("sort_order").then(({ data }) => {
      const merged = mergeWithDefaultProjectFields((data || []) as any[]).filter((f) => f.is_active && ((f.applies_to || "all") === "all" || (f.applies_to || "all") === projectType));
      setAllProjectFieldConfigs(merged);
      setAllProjectFieldConfigs(merged);
      setProjectFieldConfigs(merged);
      setProjectFieldValues((prev) => {
        const next = { ...prev };
        for (const field of merged) {
          if (!(field.field_key in next)) next[field.field_key] = field.field_type === "checkbox" ? false : "";
        }
        return next;
      });
    }).catch(() => {
      const merged = mergeWithDefaultProjectFields([]).filter((f) => (f.applies_to || "all") === "all" || (f.applies_to || "all") === projectType);
      setProjectFieldConfigs(merged);
      setProjectFieldValues((prev) => {
        const next = { ...prev };
        for (const field of merged) {
          if (!(field.field_key in next)) next[field.field_key] = field.field_type === "checkbox" ? false : "";
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    setProjectFieldConfigs(allProjectFieldConfigs.filter((f) => (f.applies_to || "all") === "all" || (f.applies_to || "all") === projectType));
  }, [projectType, allProjectFieldConfigs]);

  const handleCreate = async () => {
    if (!projectNumber.trim()) { toast.error("Bitte eine Projektnummer / Projektname eingeben"); return; }
    const activeFields = projectFieldConfigs.filter((f) => f.is_active && ((f.applies_to || "all") === "all" || (f.applies_to || "all") === projectType));
    for (const field of activeFields) {
      const value = projectFieldValues[field.field_key];
      if (field.is_required && (value === undefined || value === null || value === "" || value === false)) {
        toast.error(`Bitte ${field.field_label} ausfüllen`);
        return;
      }
    }
    setIsCreating(true);
    try {
      const fullProjectNumber = prefix ? `${prefix}${projectNumber.trim()}` : projectNumber.trim();
      const session = getSession();
      const projectId = crypto.randomUUID();
      const employeeId = session?.role === "employee" ? session.id : null;
      const customerName = typeof projectFieldValues.customerName === 'string' ? projectFieldValues.customerName.trim() : undefined;
      const customProjectFields = Object.fromEntries(
        Object.entries(projectFieldValues).filter(([k, v]) => k !== 'customerName' && v !== '' && v !== null && v !== undefined && v !== false)
      );
      const newProject: Project = {
        id: projectId,
        projectNumber: fullProjectNumber,
        customerName: customerName || undefined,
        customFields: customProjectFields,
        projectType,
        employeeId,
        accessEmployeeIds: employeeId ? [employeeId] : [],
        locations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save locally
      await indexedDBStorage.saveProject(newProject);

      // Sync to Supabase
      try {
        await supabase.from("projects").upsert({
          id: projectId,
          project_number: fullProjectNumber,
          project_type: projectType,
          customer_name: customerName || null,
          custom_fields: customProjectFields && Object.keys(customProjectFields).length > 0 ? customProjectFields : null,
          user_id: employeeId || projectId,
          employee_id: employeeId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any, { onConflict: "id" });
      } catch (e) {
        console.warn("Supabase sync failed (non-fatal):", e);
      }

      toast.success("Projekt erstellt");
      if (projectType === 'aufmass_mit_plan') navigate(`/projects/${newProject.id}/floor-plans/upload`);
      else navigate(`/projects/${newProject.id}`);
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Fehler beim Erstellen des Projekts");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate("/projects")} className="mb-4" size="sm">
          <ArrowLeft className="mr-1 md:mr-2 h-4 w-4" /><span className="text-sm md:text-base">Zurück</span>
        </Button>
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-xl md:text-2xl">Neues Projekt erstellen</CardTitle>
            <CardDescription className="text-sm md:text-base">Gib eine Projektnummer / Projektname ein und wähle den Projekttyp</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 md:space-y-6 p-4 md:p-6">
            <div className="space-y-2">
              <Label htmlFor="projectNumber">Projektnummer / Projektname</Label>
              <div className="flex items-center gap-2">
                {prefix && <span className="text-lg font-semibold text-muted-foreground px-3 py-2 bg-muted rounded-md">{prefix}</span>}
                <Input id="projectNumber" type="text" placeholder="2024-001" value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                  autoFocus className="text-lg flex-1" disabled={isCreating} />
              </div>
            </div>
            <div className="space-y-3">
              <Label>Projekttyp</Label>
              <RadioGroup value={projectType} onValueChange={(v) => setProjectType(v as 'aufmass' | 'aufmass_mit_plan')} className="grid gap-3">
                <label htmlFor="type-aufmass" className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${projectType === 'aufmass' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                  <RadioGroupItem value="aufmass" id="type-aufmass" className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium"><Ruler className="h-4 w-4" /> Aufmaß</div>
                    <p className="text-sm text-muted-foreground mt-1">Standorte mit Fotos und Bemaßungen erfassen</p>
                  </div>
                </label>
                <label htmlFor="type-plan" className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${projectType === 'aufmass_mit_plan' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                  <RadioGroupItem value="aufmass_mit_plan" id="type-plan" className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium"><Map className="h-4 w-4" /> Aufmaß mit Plan</div>
                    <p className="text-sm text-muted-foreground mt-1">Grundriss-PDF hochladen und Standorte auf dem Plan markieren</p>
                  </div>
                </label>
              </RadioGroup>
            </div>
            {projectFieldConfigs.length > 0 && (
              <div className="space-y-4">
                <Label>Projektinfos</Label>
                {projectFieldConfigs.filter((field) => field.is_active && ((field.applies_to || "all") === "all" || (field.applies_to || "all") === projectType)).map((field) => (
                  <div key={field.field_key} className="space-y-2">
                    <Label htmlFor={field.field_key}>{field.field_label}{field.is_required ? " *" : ""}</Label>
                    {field.field_type === "textarea" ? (
                      <textarea id={field.field_key} className="w-full min-h-24 rounded-md border bg-background px-3 py-2 text-sm" value={projectFieldValues[field.field_key] ?? ""} onChange={(e) => setProjectFieldValues(prev => ({ ...prev, [field.field_key]: e.target.value }))} />
                    ) : field.field_type === "dropdown" ? (
                      <select id={field.field_key} className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={projectFieldValues[field.field_key] ?? ""} onChange={(e) => setProjectFieldValues(prev => ({ ...prev, [field.field_key]: e.target.value }))}>
                        <option value="">Bitte wählen</option>
                        {(() => { try { return JSON.parse(field.field_options || '[]'); } catch { return []; } })().map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : field.field_type === "checkbox" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!projectFieldValues[field.field_key]} onChange={(e) => setProjectFieldValues(prev => ({ ...prev, [field.field_key]: e.target.checked }))} />
                        <span>Ja</span>
                      </label>
                    ) : (
                      <Input id={field.field_key} type="text" value={projectFieldValues[field.field_key] ?? ""} onChange={(e) => setProjectFieldValues(prev => ({ ...prev, [field.field_key]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button size="lg" className="w-full" onClick={handleCreate} disabled={isCreating}>
              {isCreating ? "Erstellt..." : "Projekt erstellen"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default NewProject;
