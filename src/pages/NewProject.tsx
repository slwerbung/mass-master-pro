import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Ruler, Map } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mergeWithDefaultProjectFields } from "@/lib/projectFields";

interface ProjectFieldConfig {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  field_options?: string | null;
  is_active: boolean;
  is_required?: boolean;
  sort_order: number;
  applies_to?: string;
}

const NewProject = () => {
  const [projectNumber, setProjectNumber] = useState("");
  const [projectType, setProjectType] = useState<'aufmass' | 'aufmass_mit_plan'>('aufmass');
  const [isCreating, setIsCreating] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [projectFieldConfigs, setProjectFieldConfigs] = useState<ProjectFieldConfig[]>([]);
  const [projectFieldValues, setProjectFieldValues] = useState<Record<string, string>>({});
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
    });

    supabase.from("project_field_config").select("*").eq("is_active", true).order("sort_order").then(({ data }) => {
      setProjectFieldConfigs(mergeWithDefaultProjectFields((data || []) as any[]));
    }).catch(() => {
      setProjectFieldConfigs(mergeWithDefaultProjectFields([]));
    });
  }, []);

  const filteredProjectFields = useMemo(() => {
    return projectFieldConfigs.filter((f) => {
      if (!f.applies_to || f.applies_to === 'all') return true;
      return f.applies_to === projectType;
    });
  }, [projectFieldConfigs, projectType]);

  const handleCreate = async () => {
    if (!projectNumber.trim()) { toast.error("Bitte eine Projektnummer / Projektname eingeben"); return; }

    const missing = filteredProjectFields.filter((field) => field.is_required && !String(projectFieldValues[field.field_key] || "").trim());
    if (missing.length > 0) {
      toast.error(`Bitte Pflichtfelder ausfüllen: ${missing.map((f) => f.field_label).join(", ")}`);
      return;
    }

    setIsCreating(true);
    try {
      const fullProjectNumber = prefix ? `${prefix}${projectNumber.trim()}` : projectNumber.trim();
      const session = getSession();
      const projectId = crypto.randomUUID();
      const employeeId = session?.role === "employee" ? session.id : null;
      const customerName = projectFieldValues.customerName?.trim() || undefined;
      const customProjectFields = Object.fromEntries(
        Object.entries(projectFieldValues).filter(([key, value]) => key !== 'customerName' && String(value || '').trim() !== '')
      );
      const newProject: Project = {
        id: projectId,
        projectNumber: fullProjectNumber,
        projectType,
        customerName,
        customFields: Object.keys(customProjectFields).length > 0 ? customProjectFields : undefined,
        employeeId,
        accessEmployeeIds: employeeId ? [employeeId] : [],
        locations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await indexedDBStorage.saveProject(newProject);

      try {
        await supabase.from("projects").upsert({
          id: projectId,
          project_number: fullProjectNumber,
          project_type: projectType,
          customer_name: customerName || null,
          custom_fields: Object.keys(customProjectFields).length > 0 ? customProjectFields : null,
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

  const setProjectFieldValue = (key: string, value: string) => setProjectFieldValues((prev) => ({ ...prev, [key]: value }));

  const renderProjectField = (field: ProjectFieldConfig) => {
    const value = projectFieldValues[field.field_key] || "";
    let options: string[] = [];
    try { options = field.field_options ? JSON.parse(field.field_options) : []; } catch {}

    if (field.field_type === 'textarea') {
      return <Textarea value={value} onChange={(e) => setProjectFieldValue(field.field_key, e.target.value)} placeholder={field.field_label} />;
    }
    if (field.field_type === 'dropdown') {
      return (
        <Select value={value} onValueChange={(v) => setProjectFieldValue(field.field_key, v)}>
          <SelectTrigger><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
          <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (field.field_type === 'checkbox') {
      return (
        <div className="flex items-center gap-2 h-10">
          <Checkbox checked={value === 'true'} onCheckedChange={(checked) => setProjectFieldValue(field.field_key, checked ? 'true' : 'false')} />
          <span className="text-sm text-muted-foreground">Ja / Nein</span>
        </div>
      );
    }
    return <Input type="text" placeholder={field.field_label} value={value} onChange={(e) => setProjectFieldValue(field.field_key, e.target.value)} />;
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
            <CardDescription className="text-sm md:text-base">Gib eine Projektnummer / Projektname ein und ergänze optional Projektinfos.</CardDescription>
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

            {filteredProjectFields.length > 0 && (
              <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
                <p className="text-sm font-medium">Projektinfos</p>
                <div className="grid gap-4">
                  {filteredProjectFields.map((field) => (
                    <div className="space-y-2" key={field.field_key}>
                      <Label>{field.field_label}{field.is_required ? ' *' : ''}</Label>
                      {renderProjectField(field)}
                    </div>
                  ))}
                </div>
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
