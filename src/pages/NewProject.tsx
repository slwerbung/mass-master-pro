import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { storage } from "@/lib/storage";
import { Project } from "@/types/project";
import { toast } from "sonner";

const NewProject = () => {
  const [projectNumber, setProjectNumber] = useState("");
  const navigate = useNavigate();

  const handleCreate = () => {
    if (!projectNumber.trim()) {
      toast.error("Bitte eine Projektnummer eingeben");
      return;
    }

    const newProject: Project = {
      id: crypto.randomUUID(),
      projectNumber: projectNumber.trim(),
      locations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    storage.saveProject(newProject);
    toast.success("Projekt erstellt");
    navigate(`/projects/${newProject.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Zurück
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Neues Projekt erstellen</CardTitle>
            <CardDescription>
              Gib eine Projektnummer ein, um ein neues Aufmaß-Projekt zu starten
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="projectNumber">Projektnummer</Label>
              <Input
                id="projectNumber"
                type="text"
                placeholder="z.B. 2024-001"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                autoFocus
                className="text-lg"
              />
            </div>

            <Button
              size="lg"
              className="w-full"
              onClick={handleCreate}
            >
              Projekt erstellen
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default NewProject;
