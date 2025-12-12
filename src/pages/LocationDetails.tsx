import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Check } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Location } from "@/types/project";
import { toast } from "sonner";
import { compressImage } from "@/lib/imageCompression";

const LocationDetails = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { imageData, originalImageData } = location.state || {};

  const [locationName, setLocationName] = useState("");
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!projectId || !imageData) {
      toast.error("Fehler beim Speichern");
      return;
    }

    setIsSaving(true);

    try {
      const project = await indexedDBStorage.getProject(projectId);
      if (!project) {
        toast.error("Projekt nicht gefunden");
        setIsSaving(false);
        return;
      }

      // Compress images before saving (smaller for better storage)
      toast.loading("Bild wird komprimiert...");
      const compressedImageData = await compressImage(imageData, 1280, 0.65);
      const compressedOriginalImageData = originalImageData 
        ? await compressImage(originalImageData, 1280, 0.65)
        : compressedImageData;

      const locationNumber = project.locations.length + 1;
      const fullLocationNumber = `${project.projectNumber}-${100 + locationNumber - 1}`;

      const newLocation: Location = {
        id: crypto.randomUUID(),
        locationNumber: fullLocationNumber,
        locationName: locationName.trim() || undefined,
        comment: comment.trim() || undefined,
        imageData: compressedImageData,
        originalImageData: compressedOriginalImageData,
        createdAt: new Date(),
      };

      project.locations.push(newLocation);
      
      try {
        await indexedDBStorage.saveProject(project);
        toast.dismiss();
        toast.success("Standort gespeichert");
        navigate(`/projects/${projectId}`);
      } catch (error) {
        toast.dismiss();
        console.error("Error saving location:", error);
        toast.error("Fehler beim Speichern");
      }
    } catch (error) {
      toast.dismiss();
      console.error("Error compressing image:", error);
      toast.error("Fehler beim Komprimieren des Bildes");
    } finally {
      setIsSaving(false);
    }
  };

  if (!imageData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          size="sm"
          className="md:size-default"
        >
          <ArrowLeft className="mr-1 md:mr-2 h-4 w-4" />
          <span className="text-sm md:text-base">Zurück</span>
        </Button>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-xl md:text-2xl">Standort-Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 md:space-y-6 p-4 md:p-6">
            <div className="aspect-video bg-muted rounded-lg overflow-hidden">
              <img
                src={imageData}
                alt="Bearbeitetes Bild"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="locationName">Standortbezeichnung (optional)</Label>
                <Input
                  id="locationName"
                  placeholder="z.B. Wohnzimmer, Erdgeschoss"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="comment">Kommentar (optional)</Label>
                <Textarea
                  id="comment"
                  placeholder="Zusätzliche Informationen..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                />
              </div>
            </div>

            <Button
              size="lg"
              className="w-full"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Check className="mr-2 h-5 w-5" />
              {isSaving ? "Speichert..." : "Standort speichern"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LocationDetails;
