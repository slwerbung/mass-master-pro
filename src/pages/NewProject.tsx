import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Ruler, Map } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";

const NewProject = () => {
  const [projectNumber, setProjectNumber] = useState("");
  const [projectType, setProjectType] = useState<'aufmass' | 'aufmass_mit_plan'>('aufmass');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!projectNumber.trim()) {
      toast.error("Bitte eine Projektnummer eingeben");
      return;
    }

    setIsCreating(true);

    try {
      const fullProjectNumber = `WER-${projectNumber.trim()}`;

      const newProject: Project = {
        id: crypto.randomUUID(),
        projectNumber: fullProjectNumber,
        projectType,
        locations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await indexedDBStorage.saveProject(newProject);
      toast.success("Projekt erstellt");
      
      if (projectType === 'aufmass_mit_plan') {
        navigate(`/projects/${newProject.id}/floor-plans/upload`);
      } else {
        navigate(`/projects/${newProject.id}`);
      }
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Fehler beim Erstellen des Projekts");
    } finally {
      setIsCreating(false);
    }
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
              Gib eine Projektnummer ein und wähle den Projekttyp
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
                  disabled={isCreating}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Projekttyp</Label>
              <RadioGroup
                value={projectType}
                onValueChange={(v) => setProjectType(v as 'aufmass' | 'aufmass_mit_plan')}
                className="grid gap-3"
              >
                <label
                  htmlFor="type-aufmass"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    projectType === 'aufmass' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value="aufmass" id="type-aufmass" className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <Ruler className="h-4 w-4" />
                      Aufmaß
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Standorte mit Fotos und Bemaßungen erfassen
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="type-plan"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    projectType === 'aufmass_mit_plan' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value="aufmass_mit_plan" id="type-plan" className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <Map className="h-4 w-4" />
                      Aufmaß mit Plan
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Grundriss-PDF hochladen und Standorte auf dem Plan markieren
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <Button
              size="lg"
              className="w-full"
              onClick={handleCreate}
              disabled={isCreating}
            >
              {isCreating ? "Erstellt..." : "Projekt erstellen"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default NewProject;
