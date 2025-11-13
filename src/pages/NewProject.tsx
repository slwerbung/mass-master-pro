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

    const fullProjectNumber = `WER-${projectNumber.trim()}`;

    const newProject: Project = {
      id: crypto.randomUUID(),
      projectNumber: fullProjectNumber,
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
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-4"
          size="sm"
        >
          <ArrowLeft className="mr-1 md:mr-2 h-4 w-4" />
          <span className="text-sm md:text-base">Zurück</span>
        </Button>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-xl md:text-2xl">Neues Projekt erstellen</CardTitle>
            <CardDescription className="text-sm md:text-base">
              Gib eine Projektnummer ein, um ein neues Aufmaß-Projekt zu starten
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 md:space-y-6 p-4 md:p-6">
            <div className="space-y-2">
              <Label htmlFor="projectNumber">Projektnummer</Label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-muted-foreground px-3 py-2 bg-muted rounded-md">
                  WER-
                </span>
                <Input
                  id="projectNumber"
                  type="text"
                  placeholder="2024-001"
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                  autoFocus
                  className="text-lg flex-1"
                />
              </div>
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
