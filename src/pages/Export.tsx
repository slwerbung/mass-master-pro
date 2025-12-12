import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileImage, FileText } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import jsPDF from "jspdf";

const Export = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadProject = async () => {
      if (projectId) {
        try {
          const loadedProject = await indexedDBStorage.getProject(projectId);
          if (loadedProject) {
            setProject(loadedProject);
          } else {
            toast.error("Projekt nicht gefunden");
            navigate("/");
          }
        } catch (error) {
          console.error("Error loading project:", error);
          toast.error("Fehler beim Laden des Projekts");
          navigate("/");
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadProject();
  }, [projectId, navigate]);

  const exportAsImages = async () => {
    if (!project) return;

    try {
      for (const location of project.locations) {
        // Export annotated image
        const linkAnnotated = document.createElement("a");
        linkAnnotated.href = location.imageData;
        linkAnnotated.download = `${project.projectNumber}_${location.locationNumber}_bemaßt.png`;
        document.body.appendChild(linkAnnotated);
        linkAnnotated.click();
        document.body.removeChild(linkAnnotated);
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Export original image
        const linkOriginal = document.createElement("a");
        linkOriginal.href = location.originalImageData;
        linkOriginal.download = `${project.projectNumber}_${location.locationNumber}_original.png`;
        document.body.appendChild(linkOriginal);
        linkOriginal.click();
        document.body.removeChild(linkOriginal);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      toast.success("Bilder werden heruntergeladen");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Fehler beim Export");
    }
  };

  const exportAsPDF = async () => {
    if (!project) return;

    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      let isFirstPage = true;

      for (const location of project.locations) {
        if (!isFirstPage) {
          pdf.addPage();
        }
        isFirstPage = false;

        // Header
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text(`Projekt ${project.projectNumber}`, 20, 20);

        pdf.setFontSize(12);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Standort ${location.locationNumber}`, 20, 28);

        if (location.locationName) {
          pdf.text(location.locationName, 20, 35);
        }

        // Image
        const imgY = location.locationName ? 42 : 35;
        const imgWidth = 170;
        const imgHeight = 120;

        try {
          pdf.addImage(location.imageData, "PNG", 20, imgY, imgWidth, imgHeight);
        } catch (e) {
          console.error("Error adding image:", e);
        }

        // Comment
        if (location.comment) {
          const commentY = imgY + imgHeight + 8;
          pdf.setFontSize(10);
          pdf.text("Kommentar:", 20, commentY);
          const splitComment = pdf.splitTextToSize(location.comment, 170);
          pdf.text(splitComment, 20, commentY + 5);
        }

        // Footer
        pdf.setFontSize(8);
        pdf.setTextColor(128, 128, 128);
        pdf.text(
          `Erstellt am ${new Date(location.createdAt).toLocaleDateString("de-DE")}`,
          20,
          280
        );
      }

      pdf.save(`Aufmass_${project.projectNumber}.pdf`);
      toast.success("PDF wird heruntergeladen");
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Fehler beim PDF-Export");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Zurück
        </Button>

        <div>
          <h1 className="text-3xl font-bold">Export</h1>
          <p className="text-muted-foreground mt-1">
            Projekt {project.projectNumber} exportieren
          </p>
        </div>

        <div className="grid gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={exportAsImages}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <FileImage className="h-6 w-6 text-primary" />
                Einzelne Bilder
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Alle Standorte als einzelne PNG-Dateien herunterladen
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={exportAsPDF}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-primary" />
                PDF-Dokument
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Alle Standorte in einem zusammengefassten PDF-Dokument
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Export;
