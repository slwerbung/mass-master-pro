import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FolderOpen, Calendar, LogOut, Users, RefreshCw } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { StorageIndicator } from "@/components/StorageIndicator";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";

const Projects = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const navigate = useNavigate();
  const session = getSession();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const migrated = await indexedDBStorage.migrateFromLocalStorage();
      if (migrated) toast.success("Daten wurden in neuen Speicher migriert!");
      const loadedProjects = await indexedDBStorage.getProjects();
      setProjects(loadedProjects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
    } catch (error) {
      console.error("Error loading projects:", error);
      toast.error("Fehler beim Laden der Projekte");
    } finally {
      setIsLoading(false);
    }
  };

  // Sync all local projects to Supabase so Admin can see them
  const syncToSupabase = async () => {
    setIsSyncing(true);
    try {
      const localProjects = await indexedDBStorage.getProjects();
      if (localProjects.length === 0) { toast.info("Keine Projekte zum Synchronisieren"); setIsSyncing(false); return; }
      const rows = localProjects.map(p => ({
        id: p.id,
        project_number: p.projectNumber,
        user_id: session?.id || "employee",
        employee_id: session?.role === "employee" ? session.id : null,
        created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date().toISOString(),
        updated_at: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : new Date().toISOString(),
      }));
      const { error } = await supabase.from("projects").upsert(rows, { onConflict: "id" });
      if (error) throw error;
      toast.success(`${localProjects.length} Projekt(e) synchronisiert ✓`);
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
            <Button size="lg" onClick={() => navigate("/projects/new")} className="bg-primary hover:bg-primary-hover flex-1 sm:flex-none">
              <Plus className="mr-2 h-5 w-5" /> Neues Projekt
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/projects/customers")} title="Kunden verwalten">
              <Users className="h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" onClick={syncToSupabase} disabled={isSyncing} title="Projekte mit Admin synchronisieren">
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
              <Card key={project.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/projects/${project.id}`)}>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    {project.projectNumber}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 text-xs">
                    <Calendar className="h-3 w-3" />
                    {format(project.updatedAt, "dd. MMM yyyy", { locale: de })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-sm text-muted-foreground">
                    {project.locations.length} Standort{project.locations.length !== 1 ? "e" : ""}
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
