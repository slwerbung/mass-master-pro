import { useRef, useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { X, Check, ImagePlus } from "lucide-react";
import { toast } from "sonner";

const Camera = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDetail = searchParams.get("detail") === "true";
  const detailLocationId = searchParams.get("locationId");
  const floorPlanId = searchParams.get("floorPlan");
  const presetLocationId = searchParams.get("locationId");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (!hasTriggered.current) {
      hasTriggered.current = true;
      setTimeout(() => fileInputRef.current?.click(), 100);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      goBack();
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild auswählen");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCapturedImage(reader.result as string);
    reader.onerror = () => toast.error("Fehler beim Laden des Bildes");
    reader.readAsDataURL(file);
  };

  const goBack = () => {
    if (floorPlanId) {
      navigate(`/projects/${projectId}/floor-plans`);
    } else {
      navigate(`/projects/${projectId}`);
    }
  };

  const retake = () => {
    setCapturedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setTimeout(() => fileInputRef.current?.click(), 100);
  };

  const confirm = () => {
    if (!capturedImage) return;
    let query = "";
    if (isDetail && detailLocationId) {
      query = `?detail=true&locationId=${detailLocationId}`;
    } else if (floorPlanId && presetLocationId) {
      query = `?floorPlan=${floorPlanId}&locationId=${presetLocationId}`;
    }
    navigate(`/projects/${projectId}/editor${query}`, { state: { imageData: capturedImage } });
  };

  return (
    <div className="w-screen h-[100dvh] bg-foreground flex flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex-1 relative flex items-center justify-center min-h-0">
        {capturedImage ? (
          <img
            src={capturedImage}
            alt="Aufgenommen"
            className="max-w-full max-h-full w-auto h-auto object-contain"
          />
        ) : (
          <div className="text-center p-6">
            <p className="text-background/60 mb-4">Kamera wird geöffnet…</p>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="text-background border-background/30 hover:bg-background/10"
            >
              <ImagePlus className="h-5 w-5 mr-2" />
              Foto aufnehmen
            </Button>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-foreground/80 p-4 flex items-center justify-center gap-4 safe-area-bottom">
        <Button
          size="lg"
          variant="ghost"
          onClick={goBack}
          className="text-background hover:bg-background/10"
        >
          <X className="h-6 w-6" />
        </Button>

        {capturedImage && (
          <>
            <Button
              size="lg"
              variant="ghost"
              onClick={retake}
              className="text-background hover:bg-background/10"
            >
              <X className="h-5 w-5 mr-1" />
              <span className="text-sm">Neu</span>
            </Button>
            <Button
              size="lg"
              onClick={confirm}
              className="bg-primary hover:bg-primary-hover"
            >
              <Check className="h-5 w-5 mr-1" />
              <span className="text-sm">OK</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default Camera;
