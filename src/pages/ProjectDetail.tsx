import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Camera, Download, MapPin, Trash2 } from "lucide-react";
import { storage } from "@/lib/storage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const ProjectDetail = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (projectId) {
      const loadedProject = storage.getProject(projectId);
      if (loadedProject) {
        setProject(loadedProject);
      } else {
        toast.error("Projekt nicht gefunden");
        navigate("/");
      }
    }
  }, [projectId, navigate]);

  const handleDeleteProject = () => {
    if (projectId) {
      storage.deleteProject(projectId);
      toast.success("Projekt gelöscht");
      navigate("/");
    }
  };

  const handleDeleteLocation = (locationId: string) => {
    if (project) {
      const updatedProject = {
        ...project,
        locations: project.locations.filter((l) => l.id !== locationId),
      };
      storage.saveProject(updatedProject);
      setProject(updatedProject);
      toast.success("Standort gelöscht");
    }
  };

  if (!project) {
    return <div>Laden...</div>;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="container max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zurück
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Projekt löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Diese Aktion kann nicht rückgängig gemacht werden. Alle Standorte und Aufnahmen werden gelöscht.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive">
                  Löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div>
          <h1 className="text-3xl font-bold">Projekt {project.projectNumber}</h1>
          <p className="text-muted-foreground mt-1">
            {project.locations.length} {project.locations.length === 1 ? "Standort" : "Standorte"}
          </p>
        </div>

        {project.locations.length === 0 ? (
          <Card className="border-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MapPin className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Noch keine Standorte</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Nimm das erste Foto auf, um einen Standort zu erfassen
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {project.locations.map((location) => (
              <Card key={location.id} className="overflow-hidden">
                <div className="aspect-video bg-muted relative">
                  <img
                    src={location.imageData}
                    alt={`Standort ${location.locationNumber}`}
                    className="w-full h-full object-contain"
                  />
                </div>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="font-semibold text-lg">Standort {location.locationNumber}</h3>
                      {location.locationName && (
                        <p className="text-sm text-foreground">{location.locationName}</p>
                      )}
                      {location.comment && (
                        <p className="text-sm text-muted-foreground">{location.comment}</p>
                      )}
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Standort löschen?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Diese Aktion kann nicht rückgängig gemacht werden.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteLocation(location.id)}
                            className="bg-destructive"
                          >
                            Löschen
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Fixed Bottom Actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg p-4">
        <div className="container max-w-4xl mx-auto flex gap-3">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => navigate(`/projects/${projectId}/camera`)}
          >
            <Camera className="mr-2 h-5 w-5" />
            Standort aufnehmen
          </Button>
          {project.locations.length > 0 && (
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate(`/projects/${projectId}/export`)}
            >
              <Download className="mr-2 h-5 w-5" />
              Export
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectDetail;
