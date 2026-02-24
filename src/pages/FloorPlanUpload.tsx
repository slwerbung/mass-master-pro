import { useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Upload, FileText, Loader2, Trash2 } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { FloorPlan } from "@/types/project";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface RenderedPage {
  pageIndex: number;
  name: string;
  imageData: string;
}

const FloorPlanUpload = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const allPages: RenderedPage[] = [];

    try {
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf") {
          toast.error(`${file.name} ist keine PDF-Datei`);
          continue;
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        for (let i = 0; i < pdf.numPages; i++) {
          const page = await pdf.getPage(i + 1);
          const scale = 2; // High resolution
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;

          await page.render({ canvasContext: ctx, viewport }).promise;

          const imageData = canvas.toDataURL("image/png", 0.9);
          const pageName = pdf.numPages > 1
            ? `${file.name.replace(".pdf", "")} - Seite ${i + 1}`
            : file.name.replace(".pdf", "");

          allPages.push({
            pageIndex: renderedPages.length + allPages.length,
            name: pageName,
            imageData,
          });
        }
      }

      setRenderedPages((prev) => [...prev, ...allPages]);
      toast.success(`${allPages.length} Seite(n) gerendert`);
    } catch (error) {
      console.error("PDF processing error:", error);
      toast.error("Fehler beim Verarbeiten der PDF");
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemovePage = (index: number) => {
    setRenderedPages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateName = (index: number, name: string) => {
    setRenderedPages((prev) =>
      prev.map((p, i) => (i === index ? { ...p, name } : p))
    );
  };

  const handleSave = async () => {
    if (!projectId || renderedPages.length === 0) return;

    setIsSaving(true);
    try {
      for (let i = 0; i < renderedPages.length; i++) {
        const page = renderedPages[i];
        const floorPlan: FloorPlan = {
          id: crypto.randomUUID(),
          name: page.name,
          imageData: page.imageData,
          markers: [],
          pageIndex: i,
          createdAt: new Date(),
        };
        await indexedDBStorage.saveFloorPlan(projectId, floorPlan);
      }

      toast.success("Grundrisse gespeichert");
      navigate(`/projects/${projectId}/floor-plans`);
    } catch (error) {
      console.error("Error saving floor plans:", error);
      toast.error("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate(`/projects/${projectId}`)}
          size="sm"
        >
          <ArrowLeft className="mr-1 md:mr-2 h-4 w-4" />
          Zurück
        </Button>

        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Grundrisse hochladen</h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Lade eine oder mehrere PDF-Dateien mit Grundrissen hoch
          </p>
        </div>

        <Card>
          <CardHeader className="p-4 md:p-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5" />
              PDF hochladen
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="outline"
              className="w-full h-24 border-dashed border-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  PDF wird verarbeitet...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 mr-2" />
                  PDF-Datei(en) auswählen
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {renderedPages.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              {renderedPages.length} Grundriss{renderedPages.length !== 1 ? "e" : ""}
            </h2>

            {renderedPages.map((page, index) => (
              <Card key={index}>
                <CardContent className="p-4 space-y-3">
                  <div className="aspect-[4/3] bg-muted rounded-lg overflow-hidden">
                    <img
                      src={page.imageData}
                      alt={page.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`name-${index}`} className="text-xs">
                        Bezeichnung
                      </Label>
                      <Input
                        id={`name-${index}`}
                        value={page.name}
                        onChange={(e) => handleUpdateName(index, e.target.value)}
                        placeholder="z.B. Erdgeschoss"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 mt-5 text-destructive hover:text-destructive"
                      onClick={() => handleRemovePage(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              size="lg"
              className="w-full"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Speichert...
                </>
              ) : (
                "Grundrisse speichern"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FloorPlanUpload;
