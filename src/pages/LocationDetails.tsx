import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Check } from "lucide-react";
import { storage } from "@/lib/storage";
import { Location } from "@/types/project";
import { toast } from "sonner";

const LocationDetails = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { imageData, originalImageData } = location.state || {};

  const [locationName, setLocationName] = useState("");
  const [comment, setComment] = useState("");

  const handleSave = () => {
    if (!projectId || !imageData) {
      toast.error("Fehler beim Speichern");
      return;
    }

    const project = storage.getProject(projectId);
    if (!project) {
      toast.error("Projekt nicht gefunden");
      return;
    }

    const locationNumber = project.locations.length + 1;
    const paddedNumber = locationNumber.toString().padStart(3, "0");
    const fullLocationNumber = `${project.projectNumber}-${100 + locationNumber - 1}`;

    const newLocation: Location = {
      id: crypto.randomUUID(),
      locationNumber: fullLocationNumber,
      locationName: locationName.trim() || undefined,
      comment: comment.trim() || undefined,
      imageData,
      originalImageData: originalImageData || imageData,
      createdAt: new Date(),
    };

    project.locations.push(newLocation);
    storage.saveProject(project);

    toast.success("Standort gespeichert");
    navigate(`/projects/${projectId}`);
  };

  if (!imageData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Zurück
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Standort-Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
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
            >
              <Check className="mr-2 h-5 w-5" />
              Standort speichern
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LocationDetails;
