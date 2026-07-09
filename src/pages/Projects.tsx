import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus, FolderOpen, Calendar, LogOut, Users, RefreshCw, Trash2,
  CheckSquare, X, Archive, ArchiveRestore, UserPlus, Tag, MapPin, Car, Mic,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { HeroSyncIndicator } from "@/components/HeroSyncIndicator";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";
import { syncAllToSupabase } from "@/lib/supabaseSync";
import { deleteProjectFromSupabase } from "@/lib/supabaseSync";

interface ProjectListItem {
  id: string;
  projectNumber: string;
  projectType?: "aufmass" | "aufmass_mit_plan" | "fahrzeugbeschriftung";
  customerName?: string;
  customFields?: Record<string, string>;
  createdAt: Date;
  locationCount: number;
  isLocal: boolean;
  archivedAt?: Date | null;
  employeeId?: string | null;
}

interface ProjectFieldConfig {
  field_key: string;
  field_label: string;
  is_active: boolean;
  sort_order: number;
}

type TypeFilter = "all" | "aufmass" | "aufmass_mit_plan" | "fahrzeugbeschriftung";

function ProjectTypeBadge({ type }: { type?: string }) {
  if (type === "fahrzeugbeschriftung")
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-700 border-0"><Car className="h-2.5 w-2.5 mr-0.5 inline-block" />Fahrzeug</Badge>;
  if (type === "aufmass_mit_plan")
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 border-0"><MapPin className="h-2.5 w-2.5 mr-0.5 inline-block" />Mit Grundriss</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 border-0"><MapPin className="h-2.5 w-2.5 mr-0.5 inline-block" />Aufmaß</Badge>;
}

const Projects = () => {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [projectFieldConfig, setProjectFieldConfig] = useState<ProjectFieldConfig[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const navigate = useNavigate();
  const session = getSession();
  const syncDoneRef = useRef(false);

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { loadProjectFieldConfig(); }, []);

  const loadProjectFieldConfig = async () => {
    try {
      const { data } = await supabase
        .from("project_field_config")
        .select("field_key, field_label, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      setProjectFieldConfig((data || []) as ProjectFieldConfig[]);
    } catch (error) {
      console.error("Error loading project field config:", error);
    }
  };

  const loadProjects = async (syncAfter = true) => {
    try {
      await indexedDBStorage.migrateFromLocalStorage();

      const projectQuery = supabase
        .from("projects")
        .select("id, project_number, project_type, customer_name, custom_fields, created_at, employee_id, archived_at")
        .order("created_at", { ascending: false });

      const [ownedResult, assignedResult, localSummary] = await Promise.all([
        session?.role === "employee"
          ? projectQuery.or(`employee_id.eq.${session.id},employee_id.is.null`)
          : projectQuery,
        session?.role === "employee"
          ? (supabase as any).from('project_employee_assignments').select('project_id').eq('employee_id', session.id)
          : Promise.resolve({ data: [] }),
        indexedDBStorage.getProjectsSummary(session),
      ]);

      let supabaseProjects = ownedResult.data || [];
      if (session?.role === 'employee') {
        const assignedIds: string[] = Array.from(new Set(((assignedResult as any)?.data || []).map((row: any) => row.project_id).filter(Boolean))) as string[];
        if (assignedIds.length > 0) {
          const { data: assignedProjects } = await supabase
            .from('projects')
            .select('id, project_number, project_type, customer_name, custom_fields, created_at, employee_id, archived_at')
            .in('id', assignedIds)
            .order('created_at', { ascending: false });
          const mergedRemote = new Map<string, any>();
          for (const proj of [...supabaseProjects, ...(assignedProjects || [])]) mergedRemote.set(proj.id, proj);
          supabaseProjects = Array.from(mergedRemote.values());
        }
      }

      const localMap = new Map(localSummary.map(p => [p.id, p]));
      const merged: ProjectListItem[] = supabaseProjects.map(sp => {
        const local = localMap.get(sp.id);
        return {
          id: sp.id,
          projectNumber: sp.project_number,
          projectType: sp.project_type,
          customerName: sp.customer_name ?? local?.customerName,
          customFields: (sp.custom_fields && typeof sp.custom_fields === "object" ? sp.custom_fields as Record<string, string> : undefined) ?? local?.customFields,
          createdAt: new Date(sp.created_at),
          locationCount: local?.locationCount ?? 0,
          isLocal: !!local,
          archivedAt: sp.archived_at ? new Date(sp.archived_at) : null,
          employeeId: sp.employee_id || null,
        };
      });

      const supabaseIds = new Set(supabaseProjects.map(sp => sp.id));
      if (session?.role !== "employee") {
        for (const lp of localSummary) {
          if (!supabaseIds.has(lp.id)) {
            merged.push({
              id: lp.id,
              projectNumber: lp.projectNumber,
              projectType: lp.projectType,
              customerName: lp.customerName,
              customFields: lp.customFields,
              createdAt: lp.createdAt,
              locationCount: lp.locationCount,
              isLocal: true,
            });
          }
        }
      }

      merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setProjects(merged);

      if (syncAfter && !syncDoneRef.current) {
        syncDoneRef.current = true;
        setTimeout(() => {
          syncAllToSupabase().then(() => loadProjects(false)).catch(() => {});
        }, 2000);
      }
    } catch (error) {
      console.error("Error loading projects:", error);
      toast.error("Fehler beim Laden der Projekte");
    } finally {
      setIsLoading(false);
    }
  };

  const syncToSupabase = async () => {
    setIsSyncing(true);
    try {
      await syncAllToSupabase();
      toast.success("Synchronisiert ✓");
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Sync fehlgeschlagen: " + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => { clearSession(); navigate("/"); };

  const confirmDelete = (ids: string[]) => { setPendingDeleteIds(ids); setDeleteDialogOpen(true); };

  const executeDelete = async () => {
    setIsDeleting(true);
    try {
      for (const id of pendingDeleteIds) {
        try { await deleteProjectFromSupabase(id); } catch (e) { console.warn("Remote delete failed for", id, e); }
        try { await indexedDBStorage.deleteProject(id); } catch (e) { console.warn("Local delete failed for", id, e); }
      }
      toast.success(pendingDeleteIds.length === 1 ? "Projekt gelöscht" : `${pendingDeleteIds.length} Projekte gelöscht`);
      setSelectionMode(false);
      setSelectedIds(new Set());
      setPendingDeleteIds([]);
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Fehler beim Löschen: " + e.message);
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const archiveProject = async (id: string) => {
    try {
      const { error } = await supabase.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      toast.success("Projekt archiviert");
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Fehler beim Archivieren: " + e.message);
    }
  };

  const unarchiveProject = async (id: string) => {
    try {
      const { error } = await supabase.from("projects").update({ archived_at: null }).eq("id", id);
      if (error) throw error;
      toast.success("Projekt reaktiviert");
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Fehler beim Reaktivieren: " + e.message);
    }
  };

  const claimProject = async (id: string) => {
    if (!session?.id) return;
    try {
      const { error } = await supabase.from("projects").update({ employee_id: session.id }).eq("id", id);
      if (error) throw error;
      toast.success("Projekt übernommen");
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Fehler beim Übernehmen: " + e.message);
    }
  };

  const exitSelectionMode = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const visibleProjectFields = useMemo(() => [...projectFieldConfig].sort((a, b) => a.sort_order - b.sort_order), [projectFieldConfig]);

  const getProjectInfoRows = (project: ProjectListItem) => {
    return visibleProjectFields
      .map((field) => {
        if (field.field_key === "projectNumber" || field.field_key === "customerName") return null;
        const value = typeof project.customFields?.[field.field_key] === "string" ? project.customFields![field.field_key].trim() : undefined;
        if (!value) return null;
        return { key: field.field_key, label: field.field_label, value };
      })
      .filter(Boolean) as { key: string; label: string; value: string }[];
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

  const counts = {
    all: projects.filter(p => !p.archivedAt).length,
    aufmass: projects.filter(p => !p.archivedAt && (!p.projectType || p.projectType === "aufmass")).length,
    aufmass_mit_plan: projects.filter(p => !p.archivedAt && p.projectType === "aufmass_mit_plan").length,
    fahrzeugbeschriftung: projects.filter(p => !p.archivedAt && p.projectType === "fahrzeugbeschriftung").length,
    unassigned: projects.filter(p => !p.archivedAt && !p.employeeId).length,
    archived: projects.filter(p => p.archivedAt).length,
  };

  const visibleProjects = projects.filter(p => {
    if (showArchived) return !!p.archivedAt;
    if (p.archivedAt) return false;
    if (showUnassigned) return !p.employeeId;
    if (typeFilter === "all") return true;
    if (typeFilter === "aufmass") return !p.projectType || p.projectType === "aufmass";
    return p.projectType === typeFilter;
  });

  const deleteCount = pendingDeleteIds.length;

  const filterTabs = [
    { key: "all", label: "Alle", count: counts.all, active: !showArchived && !showUnassigned && typeFilter === "all", onClick: () => { setShowArchived(false); setShowUnassigned(false); setTypeFilter("all"); } },
    { key: "aufmass", label: "Aufmaß", count: counts.aufmass, active: !showArchived && !showUnassigned && typeFilter === "aufmass", onClick: () => { setShowArchived(false); setShowUnassigned(false); setTypeFilter("aufmass"); } },
    { key: "aufmass_mit_plan", label: "Mit Plan", count: counts.aufmass_mit_plan, active: !showArchived && !showUnassigned && typeFilter === "aufmass_mit_plan", onClick: () => { setShowArchived(false); setShowUnassigned(false); setTypeFilter("aufmass_mit_plan"); } },
    { key: "fahrzeugbeschriftung", label: "Fahrzeug", count: counts.fahrzeugbeschriftung, active: !showArchived && !showUnassigned && typeFilter === "fahrzeugbeschriftung", onClick: () => { setShowArchived(false); setShowUnassigned(false); setTypeFilter("fahrzeugbeschriftung"); } },
    ...(counts.unassigned > 0 ? [{ key: "unassigned", label: "Offen", count: counts.unassigned, active: showUnassigned, onClick: () => { setShowArchived(false); setShowUnassigned(!showUnassigned); } }] : []),
    ...(counts.archived > 0 ? [{ key: "archived", label: "Archiv", count: counts.archived, active: showArchived, onClick: () => { setShowArchived(!showArchived); setShowUnassigned(false); } }] : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Captfix</h1>
            {session?.name && <p className="text-sm text-muted-foreground">{session.name}</p>}
          </div>
          <div className="flex items-center gap-1">
            {selectionMode ? (
              <>
                <span className="text-sm font-medium mr-2">{selectedIds.size} ausgewählt</span>
                <Button size="sm" variant="destructive" disabled={selectedIds.size === 0 || isDeleting} onClick={() => confirmDelete(Array.from(selectedIds))}>
                  <Trash2 className="h-4 w-4 mr-1" />Löschen
                </Button>
                <Button size="sm" variant="outline" onClick={exitSelectionMode}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => navigate("/projects/customers")} title="Kunden"><Users className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => navigate("/etiketten")} title="Etiketten"><Tag className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => navigate("/protokoll")} title="Protokoll (Diktat)"><Mic className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={syncToSupabase} disabled={isSyncing} title="Synchronisieren"><RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} /></Button>
                <Button size="sm" variant="ghost" onClick={handleLogout} title="Abmelden"><LogOut className="h-4 w-4" /></Button>
                <Button size="sm" onClick={() => navigate("/projects/new")} className="ml-1">
                  <Plus className="h-4 w-4 mr-1" />Neu
                </Button>
              </>
            )}
          </div>
        </div>

        <HeroSyncIndicator />

        {/* Pill filter tabs */}
        <div className="bg-muted rounded-xl p-1 flex gap-0.5 overflow-x-auto scrollbar-hide">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={tab.onClick}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab.active
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs ${tab.active ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                {tab.count}
              </span>
            </button>
          ))}
          <div className="flex-1" />
          {!selectionMode && projects.length > 0 && (
            <button
              onClick={() => setSelectionMode(true)}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Auswählen</span>
            </button>
          )}
        </div>

        {/* Project list */}
        {visibleProjects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm">
                {showArchived ? "Keine archivierten Projekte." : projects.length === 0 ? "Noch keine Projekte vorhanden." : "Keine Projekte in dieser Kategorie."}
              </p>
              {!showArchived && projects.length === 0 && (
                <Button className="mt-4" onClick={() => navigate("/projects/new")}>
                  <Plus className="mr-2 h-4 w-4" />Erstes Projekt erstellen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleProjects.map((project) => (
              <Card
                key={project.id}
                className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${
                  selectionMode && selectedIds.has(project.id) ? "ring-2 ring-primary border-primary" : ""
                } ${project.archivedAt ? "opacity-60" : ""}`}
                onClick={() => selectionMode ? toggleSelection(project.id) : navigate(`/projects/${project.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Type badge row */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {selectionMode && (
                          <Checkbox
                            checked={selectedIds.has(project.id)}
                            onCheckedChange={() => toggleSelection(project.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <ProjectTypeBadge type={project.projectType} />
                        {project.archivedAt && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 border-0">Archiviert</Badge>
                        )}
                        {!project.archivedAt && !project.employeeId && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-slate-100 text-slate-600 border-0">Nicht zugewiesen</Badge>
                        )}
                      </div>

                      {/* Project number */}
                      <p className="font-semibold text-base leading-snug truncate">{project.projectNumber}</p>

                      {/* Customer name */}
                      {project.customerName && (
                        <p className="text-sm text-foreground mt-0.5 truncate">{project.customerName}</p>
                      )}

                      {/* Extra fields */}
                      {getProjectInfoRows(project).slice(0, 2).map(row => (
                        <p key={row.key} className="text-xs text-muted-foreground mt-0.5 truncate">
                          {row.label}: {row.value}
                        </p>
                      ))}
                    </div>

                    {/* Action buttons */}
                    {!selectionMode && (
                      <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                        {!project.archivedAt && !project.employeeId && session?.id && (
                          <button
                            className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            title="Übernehmen"
                            onClick={(e) => { e.stopPropagation(); claimProject(project.id); }}
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {project.archivedAt ? (
                          <button
                            className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            title="Reaktivieren"
                            onClick={(e) => { e.stopPropagation(); unarchiveProject(project.id); }}
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
                            title="Archivieren"
                            onClick={(e) => { e.stopPropagation(); archiveProject(project.id); }}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Löschen"
                          onClick={(e) => { e.stopPropagation(); confirmDelete([project.id]); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Footer meta */}
                  <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-border/50 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDateTimeSafe(project.createdAt)}
                    </span>
                    {project.locationCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {project.locationCount} {project.locationCount === 1 ? "Standort" : "Standorte"}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteCount === 1 ? "Projekt löschen?" : `${deleteCount} Projekte löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCount === 1
                ? "Das Projekt und alle zugehörigen Standorte, Bilder und Daten werden unwiderruflich gelöscht."
                : `${deleteCount} Projekte und alle zugehörigen Daten werden unwiderruflich gelöscht.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Wird gelöscht..." : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Projects;
