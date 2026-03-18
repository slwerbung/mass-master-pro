import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FolderOpen, Calendar, LogOut, Users, RefreshCw } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { StorageIndicator } from "@/components/StorageIndicator";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";
import { syncAllToSupabase } from "@/lib/supabaseSync";

interface ProjectListItem {
  id: string;
  projectNumber: string;
  updatedAt: Date;
  locationCount: number;
  isLocal: boolean; // has local data (images etc.)
}

const Projects = () => {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const navigate = useNavigate();
  const session = getSession();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      await indexedDBStorage.migrateFromLocalStorage();

      const projectQuery = supabase.from("projects").select("id, project_number, updated_at, employee_id").order("updated_at", { ascending: false });
      const scopedQuery = session?.role === "employee" ? projectQuery.eq("employee_id", session.id) : projectQuery;

      const [supabaseResult, localProjects] = await Promise.all([
        scopedQuery,
        indexedDBStorage.getProjects(),
      ]);

      const localMap = new Map(localProjects.map(p => [p.id, p]));
      const supabaseProjects = supabaseResult.data || [];

      // Merge: Supabase is source of truth for list, local has location details
      const merged: ProjectListItem[] = supabaseProjects.map(sp => {
        const local = localMap.get(sp.id);
        return {
          id: sp.id,
          projectNumber: sp.project_number,
          updatedAt: new Date(sp.updated_at),
          locationCount: local?.locations?.length || 0,
          isLocal: !!local,
        };
      });

      // Also add local-only projects not yet in Supabase
      for (const lp of localProjects) {
        if (!supabaseProjects.find(sp => sp.id === lp.id)) {
          merged.push({
            id: lp.id,
            projectNumber: lp.projectNumber,
            updatedAt: lp.updatedAt,
            locationCount: lp.locations?.length || 0,
            isLocal: true,
          });
        }
      }

      merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      setProjects(merged);

      // Sync local projects to Supabase in background
      syncAllToSupabase();
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
      await loadProjects();
    } catch (e: any) {
      toast.error("Sync fehlgeschlagen: " + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => { clearSession(); navigate("/"); };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

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
        </div>

        <StorageIndicator />

        {projects.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Noch keine Projekte vorhanden.</p>
              <Button className="mt-4" onClick={() => navigate("/projects/new")}>
                <Plus className="mr-2 h-4 w-4" /> Erstes Projekt erstellen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    {project.projectNumber}
                    {!project.isLocal && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-auto">
                        Nur online
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 text-xs">
                    <Calendar className="h-3 w-3" />
                    {format(project.updatedAt, "dd. MMM yyyy", { locale: de })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-sm text-muted-foreground">
                    {project.locationCount} Standort{project.locationCount !== 1 ? "e" : ""}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Projects;
