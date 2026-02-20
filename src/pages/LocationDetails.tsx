import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  const { projectId, locationId, detailId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEditMode = !!locationId && !detailId;
  const isDetailEditMode = !!detailId;
  const isDetailImage = searchParams.get("detail") === "true";

  const { imageData: stateImageData, originalImageData: stateOriginalImageData } = location.state || {};

  const [locationName, setLocationName] = useState("");
  const [comment, setComment] = useState("");
  const [system, setSystem] = useState("");
  const [label, setLabel] = useState("");
  const [locationType, setLocationType] = useState("");
  const [caption, setCaption] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(stateImageData || null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(!isEditMode && !isDetailEditMode);

  // Load existing location data in edit mode
  useEffect(() => {
    if (isEditMode && projectId && locationId) {
      const loadLocation = async () => {
        const project = await indexedDBStorage.getProject(projectId);
        if (!project) { navigate("/"); return; }
        const loc = project.locations.find(l => l.id === locationId);
        if (!loc) { navigate(`/projects/${projectId}`); return; }
        setLocationName(loc.locationName || "");
        setComment(loc.comment || "");
        setSystem(loc.system || "");
        setLabel(loc.label || "");
        setLocationType(loc.locationType || "");
        setPreviewImage(loc.imageData);
        setIsLoaded(true);
      };
      loadLocation();
    }
  }, [isEditMode, projectId, locationId, navigate]);

  // Load existing detail image data in detail edit mode
  useEffect(() => {
    if (isDetailEditMode && locationId && detailId) {
      const loadDetail = async () => {
        const details = await indexedDBStorage.getDetailImagesByLocation(locationId);
        const detail = details.find(d => d.id === detailId);
        if (!detail) { navigate(`/projects/${projectId}`); return; }
        setCaption(detail.caption || "");
        setPreviewImage(detail.imageData);
        setIsLoaded(true);
      };
      loadDetail();
    }
  }, [isDetailEditMode, locationId, detailId, projectId, navigate]);

  const handleSave = async () => {
    if (!projectId) { toast.error("Fehler beim Speichern"); return; }

    setIsSaving(true);

    try {
      if (isDetailEditMode && detailId) {
        await indexedDBStorage.updateDetailImageMetadata(detailId, {
          caption: caption.trim() || undefined,
        });
        toast.success("Detailbild aktualisiert");
        navigate(`/projects/${projectId}`);
      } else if (isEditMode && locationId) {
        await indexedDBStorage.updateLocationMetadata(projectId, locationId, {
          locationName: locationName.trim() || undefined,
          comment: comment.trim() || undefined,
          system: system.trim() || undefined,
          label: label.trim() || undefined,
          locationType: locationType.trim() || undefined,
        });
        toast.success("Standort aktualisiert");
        navigate(`/projects/${projectId}`);
      } else if (isDetailImage && stateImageData) {
        toast.loading("Bild wird komprimiert...");
        const compressedImageData = await compressImage(stateImageData, 1280, 0.65);
        const compressedOriginalImageData = stateOriginalImageData
          ? await compressImage(stateOriginalImageData, 1280, 0.65)
          : compressedImageData;

        const targetLocationId = searchParams.get("locationId");
        if (!targetLocationId) { toast.error("Standort nicht gefunden"); return; }

        const detailImage = {
          id: crypto.randomUUID(),
          imageData: compressedImageData,
          originalImageData: compressedOriginalImageData,
          caption: caption.trim() || undefined,
          createdAt: new Date(),
        };

        await indexedDBStorage.saveDetailImage(targetLocationId, detailImage);
        toast.dismiss();
        toast.success("Detailbild gespeichert");
        navigate(`/projects/${projectId}`);
      } else if (stateImageData) {
        const project = await indexedDBStorage.getProject(projectId);
        if (!project) { toast.error("Projekt nicht gefunden"); setIsSaving(false); return; }

        toast.loading("Bild wird komprimiert...");
        const compressedImageData = await compressImage(stateImageData, 1280, 0.65);
        const compressedOriginalImageData = stateOriginalImageData
          ? await compressImage(stateOriginalImageData, 1280, 0.65)
          : compressedImageData;

        const locationNumber = project.locations.length + 1;
        const fullLocationNumber = `${project.projectNumber}-${100 + locationNumber - 1}`;

        const newLocation: Location = {
          id: crypto.randomUUID(),
          locationNumber: fullLocationNumber,
          locationName: locationName.trim() || undefined,
          comment: comment.trim() || undefined,
          system: system.trim() || undefined,
          label: label.trim() || undefined,
          locationType: locationType.trim() || undefined,
          imageData: compressedImageData,
          originalImageData: compressedOriginalImageData,
          createdAt: new Date(),
        };

        project.locations.push(newLocation);
        await indexedDBStorage.saveProject(project);
        toast.dismiss();
        toast.success("Standort gespeichert");
        navigate(`/projects/${projectId}`);
      }
    } catch (error) {
      toast.dismiss();
      console.error("Error saving:", error);
      toast.error("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isLoaded || (!isEditMode && !isDetailEditMode && !stateImageData)) {
    return null;
  }

  const title = isDetailEditMode
    ? "Detailbild bearbeiten"
    : isEditMode
      ? "Standort bearbeiten"
      : isDetailImage
        ? "Detailbild-Details"
        : "Standort-Details";

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)} size="sm" className="md:size-default">
          <ArrowLeft className="mr-1 md:mr-2 h-4 w-4" />
          <span className="text-sm md:text-base">Zurück</span>
        </Button>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-xl md:text-2xl">{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 md:space-y-6 p-4 md:p-6">
            {previewImage && (
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                <img src={previewImage} alt="Bild" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="space-y-4">
              {isDetailImage || isDetailEditMode ? (
                <div className="space-y-2">
                  <Label htmlFor="caption">Beschreibung (optional)</Label>
                  <Input
                    id="caption"
                    placeholder="z.B. Detail Fensterrahmen"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                  />
                </div>
              ) : (
                <>
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
                    <Label htmlFor="system">System (optional)</Label>
                    <Input
                      id="system"
                      placeholder="z.B. Türschilder, Wegweiser"
                      value={system}
                      onChange={(e) => setSystem(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="label">Beschriftung (optional)</Label>
                    <Input
                      id="label"
                      placeholder="z.B. Raum 101"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="locationType">Art (optional)</Label>
                    <Input
                      id="locationType"
                      placeholder="z.B. Raum, Flur, Eingang"
                      value={locationType}
                      onChange={(e) => setLocationType(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="comment">Kommentar (optional)</Label>
                    <Textarea
                      id="comment"
                      placeholder="Zusätzliche Informationen..."
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                    />
                  </div>
                </>
              )}
            </div>

            <Button size="lg" className="w-full" onClick={handleSave} disabled={isSaving}>
              <Check className="mr-2 h-5 w-5" />
              {isSaving ? "Speichert..." : isEditMode || isDetailEditMode ? "Änderungen speichern" : "Speichern"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LocationDetails;
