import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Ruler, Map, Car, Search, X } from "lucide-react";
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
  const [projectType, setProjectType] = useState<'aufmass' | 'aufmass_mit_plan' | 'fahrzeugbeschriftung'>('aufmass');
  const [isCreating, setIsCreating] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [projectFieldConfigs, setProjectFieldConfigs] = useState<ProjectFieldConfig[]>([]);
  const [projectFieldValues, setProjectFieldValues] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const [heroEnabled, setHeroEnabled] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");
  const [heroResults, setHeroResults] = useState<any[]>([]);
  const [heroSearching, setHeroSearching] = useState(false);
  const [heroProject, setHeroProject] = useState<any>(null);
  const [showHeroSearch, setShowHeroSearch] = useState(false);

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

    // Check if HERO integration is active via Edge Function (no auth needed for this check)
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-manage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action: "get_integration_config" }),
    }).then(r => r.json()).then(data => {
      if (data?.hero?.enabled) setHeroEnabled(true);
    }).catch(() => {});

    supabase.from("project_field_config").select("*").eq("is_active", true).order("sort_order").then(({ data }) => {
      setProjectFieldConfigs(mergeWithDefaultProjectFields((data || []) as any[]));
    }).catch(() => {
      setProjectFieldConfigs(mergeWithDefaultProjectFields([]));
    });
  }, []);

  const filteredProjectFields = useMemo(() => {
    return projectFieldConfigs.filter((f) => {
      if (!f.applies_to || f.applies_to === 'all') return true;
      return f.applies_to === projectType || f.applies_to === 'fahrzeugbeschriftung';
    });
  }, [projectFieldConfigs, projectType]);

  const searchHeroProjects = async (term: string) => {
    if (!term.trim()) { setHeroResults([]); return; }
    setHeroSearching(true);
    try {
      const session = getSession();
      const { data, error } = await supabase.functions.invoke("hero-integration", {
        body: { action: "search_projects", search: term, sessionToken: session?.authToken || "valid" },
      });
      if (!error && data?.projects) setHeroResults(data.projects);
    } catch {}
    finally { setHeroSearching(false); }
  };

  const selectHeroProject = (project: any) => {
    setHeroProject(project);
    setShowHeroSearch(false);
    setHeroResults([]);
    setHeroSearch("");
    // Auto-fill project number and customer name
    if (project.project_nr) setProjectNumber(project.project_nr.replace(/^[A-Z]+-/i, ""));
    const cust = project.customer;
    if (cust) {
      const name = cust.company_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ");
      setProjectFieldValues(prev => ({ ...prev, customerName: name }));
    }
  };

  const clearHeroProject = () => {
    setHeroProject(null);
    setProjectNumber("");
    setProjectFieldValues(prev => ({ ...prev, customerName: "" }));
  };

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
      // Store HERO project reference if linked
      if (heroProject?.id) {
        customProjectFields.__hero_project_id = String(heroProject.id);
        customProjectFields.__hero_project_nr = heroProject.project_nr || "";
      }
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
      navigate(`/projects/${newProject.id}`);
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
            {/* HERO Integration: search & link project */}
            {heroEnabled && (
              <div className="space-y-2">
                <Label>HERO Projekt verknüpfen <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
                {heroProject ? (
                  <div className="flex items-center justify-between gap-2 p-3 rounded-lg border bg-primary/5 border-primary/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{heroProject.project_nr}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {heroProject.customer?.company_name || [heroProject.customer?.first_name, heroProject.customer?.last_name].filter(Boolean).join(" ")}
                        {heroProject.address?.city ? ` · ${heroProject.address.city}` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearHeroProject}><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Projektnr., Kundenname, Adresse..."
                          value={heroSearch}
                          onChange={e => { setHeroSearch(e.target.value); setShowHeroSearch(true); }}
                          onKeyDown={e => e.key === "Enter" && searchHeroProjects(heroSearch)}
                          className="pl-9"
                        />
                      </div>
                      <Button variant="outline" onClick={() => searchHeroProjects(heroSearch)} disabled={heroSearching}>
                        {heroSearching ? "Suche..." : "Suchen"}
                      </Button>
                    </div>
                    {showHeroSearch && heroResults.length > 0 && (
                      <div className="border rounded-lg overflow-hidden shadow-md bg-background max-h-60 overflow-y-auto">
                        {heroResults.map(p => (
                          <button
                            key={p.id}
                            onClick={() => selectHeroProject(p)}
                            className="w-full text-left px-3 py-2.5 hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                          >
                            <p className="text-sm font-medium">{p.project_nr}
                              {p.current_project_match_status?.name && (
                                <span className="ml-2 text-xs text-muted-foreground font-normal">· {p.current_project_match_status.name}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {p.customer?.company_name || [p.customer?.first_name, p.customer?.last_name].filter(Boolean).join(" ")}
                              {p.address?.city ? ` · ${p.address.city}` : ""}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                    {showHeroSearch && !heroSearching && heroResults.length === 0 && heroSearch && (
                      <p className="text-xs text-muted-foreground px-1">Keine Projekte gefunden</p>
                    )}
                  </div>
                )}
              </div>
            )}
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
              <RadioGroup value={projectType} onValueChange={(v) => setProjectType(v as 'aufmass' | 'aufmass_mit_plan' | 'fahrzeugbeschriftung')} className="grid gap-3">
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
                <label htmlFor="type-vehicle" className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${projectType === 'fahrzeugbeschriftung' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                  <RadioGroupItem value="fahrzeugbeschriftung" id="type-vehicle" className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium"><Car className="h-4 w-4" /> Fahrzeugbeschriftung</div>
                    <p className="text-sm text-muted-foreground mt-1">Fahrzeugbilder, Informationen und Layout für Kundenfeedback</p>
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
