import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FolderOpen, Calendar, LogOut, Users, RefreshCw, Trash2, CheckSquare, X, Archive, ArchiveRestore } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { de } from "date-fns/locale";
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
}

interface ProjectFieldConfig {
  field_key: string;
  field_label: string;
  is_active: boolean;
  sort_order: number;
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
  // Filter state. typeFilter "all" shows every type; the per-type tabs
  // narrow the list. showArchived toggles the archive view - default
  // off so the main view stays uncluttered.
  const [typeFilter, setTypeFilter] = useState<"all" | "aufmass" | "aufmass_mit_plan" | "fahrzeugbeschriftung">("all");
  const [showArchived, setShowArchived] = useState(false);
  const navigate = useNavigate();
  const session = getSession();
  const syncDoneRef = useRef(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    loadProjectFieldConfig();
  }, []);

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

      const projectQuery = supabase.from("projects").select("id, project_number, project_type, customer_name, custom_fields, created_at, employee_id, archived_at").order("created_at", { ascending: false });

      const [ownedResult, assignedResult, localSummary] = await Promise.all([
        session?.role === "employee" ? projectQuery.eq("employee_id", session.id) : projectQuery,
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

      // Location counts come from IndexedDB (fast, local) - no extra Supabase query needed
      // Online-only projects show 0 until synced locally

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
        // Defer sync by 2s so the UI is fully interactive before network load starts
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

  // --- Delete logic ---
  const confirmDelete = (ids: string[]) => {
    setPendingDeleteIds(ids);
    setDeleteDialogOpen(true);
  };

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

  // --- Archive logic ---
  // Setting archived_at to a timestamp (or NULL) is a soft delete - the
  // project is hidden from the default view but stays intact and can
  // come back via the archive tab. The pg_cron job in the migration
  // does the same with `now()` for projects untouched 90+ days.
  const archiveProject = async (id: string) => {
    try {
      const { error } = await supabase
        .from("projects")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Projekt archiviert");
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Fehler beim Archivieren: " + e.message);
    }
  };

  const unarchiveProject = async (id: string) => {
    try {
      const { error } = await supabase
        .from("projects")
        .update({ archived_at: null })
        .eq("id", id);
      if (error) throw error;
      toast.success("Projekt reaktiviert");
      await loadProjects(false);
    } catch (e: any) {
      toast.error("Fehler beim Reaktivieren: " + e.message);
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };


  const visibleProjectFields = useMemo(() => {
    const configs = [...projectFieldConfig].sort((a, b) => a.sort_order - b.sort_order);
    return configs;
  }, [projectFieldConfig]);

  const getProjectInfoRows = (project: ProjectListItem) => {
    return visibleProjectFields
      .map((field) => {
        const key = field.field_key;
        // projectNumber is already shown as the card title – skip it here
        if (key === "projectNumber") return null;
        let value: string | undefined;
        if (key === "customerName") return null; // Customer is rendered prominently above, not as a small info row
        else value = project.customFields?.[key];
        value = typeof value === "string" ? value.trim() : value;
        if (!value) return null;
        return { key, label: field.field_label, value };
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

  const deleteCount = pendingDeleteIds.length;

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Aufmaß App</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">
              {session?.name ? `Angemeldet als ${session.name}` : "Projekte verwalten"}
            </p>
          </div>

          {selectionMode ? (
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} ausgewählt
              </span>
              <Button
                size="lg"
                variant="destructive"
                disabled={selectedIds.size === 0 || isDeleting}
                onClick={() => confirmDelete(Array.from(selectedIds))}
              >
                <Trash2 className="mr-2 h-5 w-5" />
                Löschen
              </Button>
              <Button size="lg" variant="outline" onClick={exitSelectionMode}>
                <X className="mr-2 h-5 w-5" />
                Abbrechen
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <Button size="lg" onClick={() => navigate("/projects/new")} className="flex-1 sm:flex-none">
                <Plus className="mr-2 h-5 w-5" /> Neues Projekt
              </Button>
              
              <Button size="lg" variant="outline" onClick={() => navigate("/projects/customers")} title="Kunden verwalten">
                <Users className="h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline" onClick={syncToSupabase} disabled={isSyncing} title="Synchronisieren">
                <RefreshCw className={`h-5 w-5 ${isSyncing ? "animate-spin" : ""}`} />
              </Button>
              <Button size="lg" variant="ghost" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          )}
        </div>

        <HeroSyncIndicator />

        {projects.length > 0 && !selectionMode && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
              <CheckSquare className="mr-2 h-4 w-4" />
              Auswählen
            </Button>
          </div>
        )}

        {/* Filter bar: type tabs + archive toggle. Shown above the list
            but below the action header. Counts are derived from the
            already-loaded projects so switching tabs is instant. */}
        {(() => {
          // Compute counts and filtered list inside an IIFE so the JSX
          // stays declarative and we don't need extra useMemo plumbing
          // for what's essentially a cheap array filter.
          const counts = {
            all: projects.filter(p => !p.archivedAt).length,
            aufmass: projects.filter(p => !p.archivedAt && p.projectType === "aufmass").length,
            aufmass_mit_plan: projects.filter(p => !p.archivedAt && p.projectType === "aufmass_mit_plan").length,
            fahrzeugbeschriftung: projects.filter(p => !p.archivedAt && p.projectType === "fahrzeugbeschriftung").length,
            archived: projects.filter(p => p.archivedAt).length,
          };
          const visibleProjects = projects.filter(p => {
            if (showArchived) return !!p.archivedAt;
            if (p.archivedAt) return false;
            if (typeFilter === "all") return true;
            return p.projectType === typeFilter;
          });
          return (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Button size="sm" variant={!showArchived && typeFilter === "all" ? "default" : "outline"} onClick={() => { setShowArchived(false); setTypeFilter("all"); }}>
                  Alle ({counts.all})
                </Button>
                <Button size="sm" variant={!showArchived && typeFilter === "aufmass" ? "default" : "outline"} onClick={() => { setShowArchived(false); setTypeFilter("aufmass"); }}>
                  Aufmaß ({counts.aufmass})
                </Button>
                <Button size="sm" variant={!showArchived && typeFilter === "aufmass_mit_plan" ? "default" : "outline"} onClick={() => { setShowArchived(false); setTypeFilter("aufmass_mit_plan"); }}>
                  Aufmaß mit Plan ({counts.aufmass_mit_plan})
                </Button>
                <Button size="sm" variant={!showArchived && typeFilter === "fahrzeugbeschriftung" ? "default" : "outline"} onClick={() => { setShowArchived(false); setTypeFilter("fahrzeugbeschriftung"); }}>
                  Fahrzeug ({counts.fahrzeugbeschriftung})
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived(!showArchived)}>
                  Archiv ({counts.archived})
                </Button>
              </div>

              {visibleProjects.length === 0 ? (
                <Card className="text-center py-12">
                  <CardContent>
                    <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {showArchived ? "Keine archivierten Projekte." : projects.length === 0 ? "Noch keine Projekte vorhanden." : "Keine Projekte in dieser Kategorie."}
                    </p>
                    {!showArchived && projects.length === 0 && (
                      <Button className="mt-4" onClick={() => navigate("/projects/new")}>
                        <Plus className="mr-2 h-4 w-4" /> Erstes Projekt erstellen
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {visibleProjects.map((project) => (
                    <Card
                      key={project.id}
                      className={`cursor-pointer hover:shadow-md transition-shadow ${
                        selectionMode && selectedIds.has(project.id) ? "ring-2 ring-primary" : ""
                      } ${project.archivedAt ? "opacity-60" : ""}`}
                      onClick={() => {
                        if (selectionMode) {
                          toggleSelection(project.id);
                        } else {
                          navigate(`/projects/${project.id}`);
                        }
                }}
              >
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    {selectionMode && (
                      <Checkbox
                        checked={selectedIds.has(project.id)}
                        onCheckedChange={() => toggleSelection(project.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mr-1"
                      />
                    )}
                    <FolderOpen className="h-5 w-5 text-primary" />
                    <span className="truncate">{project.projectNumber}</span>
                    {project.archivedAt && (
                      <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded ml-auto shrink-0">
                        Archiviert
                      </span>
                    )}
                    {!selectionMode && (
                      <div className="ml-auto shrink-0 flex items-center gap-1">
                        {project.archivedAt ? (
                          <button
                            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            title="Reaktivieren"
                            onClick={(e) => {
                              e.stopPropagation();
                              unarchiveProject(project.id);
                            }}
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                            title="Archivieren"
                            onClick={(e) => {
                              e.stopPropagation();
                              archiveProject(project.id);
                            }}
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Projekt löschen"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete([project.id]);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 text-xs">
                    <Calendar className="h-3 w-3" />
                    Erstellt am {formatDateTimeSafe(project.createdAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {project.customerName && (
                    <p className="text-base font-medium text-foreground break-words">
                      {project.customerName}
                    </p>
                  )}
                  {getProjectInfoRows(project).length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {getProjectInfoRows(project).map((row) => (
                        <div key={row.key} className="text-xs">
                          <span className="text-muted-foreground">{row.label}: </span>
                          <span className="text-foreground break-words">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
                  ))}
                </div>
              )}
            </>
          );
        })()}
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
                : `${deleteCount} Projekte und alle zugehörigen Standorte, Bilder und Daten werden unwiderruflich gelöscht.`}
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
