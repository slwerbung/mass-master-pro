import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FolderOpen, Calendar } from "lucide-react";
import { storage } from "@/lib/storage";
import { Project } from "@/types/project";
import { format } from "date-fns";
import { de } from "date-fns/locale";

const Projects = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = () => {
    const loadedProjects = storage.getProjects();
    setProjects(loadedProjects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Aufmaß App</h1>
            <p className="text-muted-foreground mt-1">Projekte verwalten</p>
          </div>
          <Button
            size="lg"
            onClick={() => navigate("/projects/new")}
            className="bg-primary hover:bg-primary-hover"
          >
            <Plus className="mr-2 h-5 w-5" />
            Neues Projekt
          </Button>
        </div>

        {projects.length === 0 ? (
          <Card className="border-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Noch keine Projekte</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Erstelle dein erstes Projekt, um mit dem Aufmaß zu beginnen
              </p>
              <Button onClick={() => navigate("/projects/new")} size="lg">
                <Plus className="mr-2 h-5 w-5" />
                Erstes Projekt erstellen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Projekt {project.projectNumber}</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {project.locations.length} Standorte
                    </span>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {format(project.updatedAt, "dd. MMMM yyyy", { locale: de })}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Projects;
