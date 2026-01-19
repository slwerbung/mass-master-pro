import { useRef, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Camera as CameraIcon, X, Check } from "lucide-react";
import { toast } from "sonner";

const Camera = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1920, height: 1080 },
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error) {
      console.error("Camera error:", error);
      toast.error("Kamera konnte nicht gestartet werden");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imageData = canvas.toDataURL("image/jpeg", 0.9);
        setCapturedImage(imageData);
        stopCamera();
      }
    }
  };

  const retakePhoto = () => {
    setCapturedImage(null);
    startCamera();
  };

  const confirmPhoto = () => {
    if (capturedImage) {
      navigate(`/projects/${projectId}/editor`, { state: { imageData: capturedImage } });
    }
  };

  return (
    <div className="app-screen bg-foreground flex flex-col overflow-hidden">
      <div className="flex-1 relative flex items-center justify-center min-h-0">
        {!capturedImage ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
        ) : (
          <img
            src={capturedImage}
            alt="Captured"
            className="w-full h-full object-contain"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="shrink-0 bg-foreground/80 p-4 flex items-center justify-center gap-4 safe-area-bottom">
        <Button
          size="lg"
          variant="ghost"
          onClick={() => navigate(`/projects/${projectId}`)}
          className="text-background hover:bg-background/10"
        >
          <X className="h-6 w-6" />
        </Button>

        {!capturedImage ? (
          <Button
            size="lg"
            onClick={capturePhoto}
            className="h-16 w-16 rounded-full bg-background hover:bg-muted"
          >
            <CameraIcon className="h-6 w-6 text-foreground" />
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              variant="ghost"
              onClick={retakePhoto}
              className="text-background hover:bg-background/10"
            >
              <X className="h-5 w-5 mr-1" />
              <span className="text-sm">Neu</span>
            </Button>
            <Button
              size="lg"
              onClick={confirmPhoto}
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
