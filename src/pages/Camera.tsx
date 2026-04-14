import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { X, Check, ImagePlus, Camera as CameraIcon } from "lucide-react";
import { toast } from "sonner";
import { readImageFileForEditor } from "@/lib/imageFile";

const Camera = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDetail = searchParams.get("detail") === "true";
  const detailLocationId = searchParams.get("locationId");
  const floorPlanId = searchParams.get("floorPlan");
  const presetLocationId = searchParams.get("locationId");
  const mode = searchParams.get("mode"); // "upload" or default (camera)

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [streaming, setStreaming] = useState(false);
  const hasTriggered = useRef(false);
  const isProcessingFile = useRef(false); // Guard against double-fire on Android/iOS

  // Detect desktop vs mobile
  useEffect(() => {
    const isMobile = navigator.maxTouchPoints > 0;
    setIsDesktop(!isMobile);
  }, []);

  // Start webcam stream on desktop
  const startStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (err) {
      console.error("Webcam error:", err);
      toast.error("Kamera konnte nicht geöffnet werden");
      // Fallback to file input
      fileInputRef.current?.click();
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  // Initialize: desktop → start webcam, mobile → trigger file input
  useEffect(() => {
    if (hasTriggered.current || isDesktop === null) return;
    hasTriggered.current = true;

    if (mode === "upload") {
      setTimeout(() => fileInputRef.current?.click(), 100);
    } else if (isDesktop) {
      setTimeout(() => startStream(), 100);
    } else {
      setTimeout(() => fileInputRef.current?.click(), 100);
    }
  }, [isDesktop, mode, startStream]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  const takeSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(dataUrl);
    stopStream();
  };

  const navigateToEditor = (imageData: string) => {
    stopStream();
    let query = "";
    if (isDetail && detailLocationId) {
      query = `?detail=true&locationId=${detailLocationId}`;
    } else if (floorPlanId && presetLocationId) {
      query = `?floorPlan=${floorPlanId}&locationId=${presetLocationId}`;
    }
    navigate(`/projects/${projectId}/editor${query}`, { state: { imageData } });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Guard against double-fire (common on Android/iOS with capture="environment")
    if (isProcessingFile.current) return;
    const file = e.target.files?.[0];
    // No file = user cancelled (only allow goBack if we haven't already processed a file)
    if (!file) {
      if (!capturedImage) goBack();
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild auswählen");
      return;
    }
    // Lock immediately before any async work
    isProcessingFile.current = true;
    try {
      const imageData = await readImageFileForEditor(file);
      const shouldSkipConfirmation = !isDesktop && mode !== "upload";
      if (shouldSkipConfirmation) {
        navigateToEditor(imageData);
        // Don't reset isProcessingFile – component will unmount after navigate
        return;
      }
      setCapturedImage(imageData);
    } catch {
      toast.error("Fehler beim Laden des Bildes");
      isProcessingFile.current = false; // Only reset on error so user can retry
    }
  };

  const goBack = () => {
    stopStream();
    if (floorPlanId) {
      navigate(`/projects/${projectId}/floor-plans`);
    } else {
      navigate(`/projects/${projectId}`);
    }
  };

  const retake = () => {
    setCapturedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (isDesktop && mode !== "upload") {
      setTimeout(() => startStream(), 100);
    } else {
      setTimeout(() => fileInputRef.current?.click(), 100);
    }
  };

  const confirm = () => {
    if (!capturedImage) return;
    navigateToEditor(capturedImage);
  };

  return (
    <div className="w-screen h-[100dvh] bg-foreground flex flex-col overflow-hidden">
      {/* Hidden file input for mobile / upload mode */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        {...(!isDesktop && mode !== "upload" ? { capture: "environment" as const } : {})}
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
        ) : isDesktop && mode !== "upload" ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full w-auto h-auto object-contain"
            />
            {streaming && (
              <Button
                size="lg"
                onClick={takeSnapshot}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full w-16 h-16 bg-white hover:bg-white/90 border-4 border-background/30"
              >
                <CameraIcon className="h-7 w-7 text-foreground" />
              </Button>
            )}
            {!streaming && (
              <div className="text-center p-6">
                <p className="text-background/60 mb-4">Kamera wird geöffnet…</p>
              </div>
            )}
          </div>
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
