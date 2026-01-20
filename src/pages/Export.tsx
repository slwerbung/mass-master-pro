import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileImage, FileText, Download, Archive, Loader2 } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { 
  downloadImage, 
  downloadBlob, 
  dataURItoBlob, 
  isIOSDevice 
} from "@/lib/exportUtils";

const Export = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState<Record<string, boolean>>({});
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

  const handleDownloadImage = async (
    locationId: string,
    imageData: string, 
    filename: string,
    type: 'annotated' | 'original'
  ) => {
    const key = `${locationId}-${type}`;
    setDownloadingImages(prev => ({ ...prev, [key]: true }));
    
    try {
      const success = await downloadImage(imageData, filename);
      if (success) {
        if (isIOSDevice()) {
          toast.success("Bild wird geladen - ggf. lange drücken zum Speichern");
        } else {
          toast.success("Bild heruntergeladen");
        }
      } else {
        toast.error("Download fehlgeschlagen");
      }
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Fehler beim Download");
    } finally {
      setDownloadingImages(prev => ({ ...prev, [key]: false }));
    }
  };

  const exportAsZip = async () => {
    if (!project) return;

    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      
      for (const location of project.locations) {
        // Add annotated image
        const annotatedBlob = dataURItoBlob(location.imageData);
        zip.file(
          `${project.projectNumber}_${location.locationNumber}_bemasst.png`,
          annotatedBlob
        );

        // Add original image
        const originalBlob = dataURItoBlob(location.originalImageData);
        zip.file(
          `${project.projectNumber}_${location.locationNumber}_original.png`,
          originalBlob
        );
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const success = await downloadBlob(
        zipBlob, 
        `Aufmass_${project.projectNumber}.zip`
      );
      
      if (success) {
        toast.success("ZIP-Datei wird heruntergeladen");
      } else {
        toast.error("ZIP-Download fehlgeschlagen");
      }
    } catch (error) {
      console.error("ZIP export error:", error);
      toast.error("Fehler beim ZIP-Export");
    } finally {
      setDownloadingZip(false);
    }
  };

  const exportAsPDF = async () => {
    if (!project) return;

    setDownloadingPDF(true);
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
        pdf.setTextColor(0, 0, 0);
      }

      // Generate as blob for reliable download
      const pdfBlob = pdf.output("blob");
      const success = await downloadBlob(
        pdfBlob, 
        `Aufmass_${project.projectNumber}.pdf`
      );
      
      if (success) {
        toast.success("PDF wird heruntergeladen");
      } else {
        toast.error("PDF-Download fehlgeschlagen");
      }
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Fehler beim PDF-Export");
    } finally {
      setDownloadingPDF(false);
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

        {/* PDF Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              PDF-Dokument
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Alle Standorte in einem zusammengefassten PDF-Dokument
            </p>
            <Button 
              onClick={exportAsPDF} 
              disabled={downloadingPDF}
              className="w-full"
            >
              {downloadingPDF ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              PDF herunterladen
            </Button>
          </CardContent>
        </Card>

        {/* ZIP Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <Archive className="h-5 w-5 text-primary" />
              Alle Bilder als ZIP
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Alle Standorte (bemaßt + original) in einer ZIP-Datei
            </p>
            <Button 
              onClick={exportAsZip} 
              disabled={downloadingZip}
              variant="secondary"
              className="w-full"
            >
              {downloadingZip ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              ZIP herunterladen
            </Button>
          </CardContent>
        </Card>

        {/* Individual Images */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <FileImage className="h-5 w-5 text-primary" />
              Einzelne Bilder
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Standorte einzeln herunterladen
            </p>
            
            {project.locations.map((location) => (
              <div 
                key={location.id} 
                className="border rounded-lg p-3 space-y-2"
              >
                <div className="font-medium text-sm">
                  Standort {location.locationNumber}
                  {location.locationName && (
                    <span className="text-muted-foreground font-normal ml-2">
                      {location.locationName}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={downloadingImages[`${location.id}-annotated`]}
                    onClick={() => handleDownloadImage(
                      location.id,
                      location.imageData,
                      `${project.projectNumber}_${location.locationNumber}_bemasst.png`,
                      'annotated'
                    )}
                  >
                    {downloadingImages[`${location.id}-annotated`] ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <FileImage className="h-3 w-3 mr-1" />
                    )}
                    Bemaßt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={downloadingImages[`${location.id}-original`]}
                    onClick={() => handleDownloadImage(
                      location.id,
                      location.originalImageData,
                      `${project.projectNumber}_${location.locationNumber}_original.png`,
                      'original'
                    )}
                  >
                    {downloadingImages[`${location.id}-original`] ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <FileImage className="h-3 w-3 mr-1" />
                    )}
                    Original
                  </Button>
                </div>
              </div>
            ))}

            {isIOSDevice() && (
              <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                💡 Tipp: Auf iPad/iPhone ggf. lange auf das Bild drücken → "In Fotos speichern"
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Export;
