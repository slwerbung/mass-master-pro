import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Canvas as FabricCanvas, PencilBrush, Line, IText, FabricImage } from "fabric";
import { Pencil, Type, Ruler, Undo, Redo, ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMeasurementGroup } from "@/lib/measurement";

type Tool = "select" | "draw" | "text" | "measure";

const PhotoEditor = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const imageData = location.state?.imageData;

  useEffect(() => {
    if (!imageData) {
      toast.error("Kein Bild gefunden");
      navigate(`/projects/${projectId}`);
      return;
    }

    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight - 200,
      backgroundColor: "#ffffff",
    });

    // Load the captured image
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(
        canvas.width! / img.width,
        canvas.height! / img.height
      );
      
      const fabricImage = new FabricImage(img, {
        scaleX: scale,
        scaleY: scale,
        originX: "center",
        originY: "center",
        left: canvas.width! / 2,
        top: canvas.height! / 2,
      });
      
      canvas.backgroundImage = fabricImage;
      canvas.renderAll();
    };
    img.src = imageData;

    const brush = new PencilBrush(canvas);
    brush.color = "#ef4444";
    brush.width = 3;
    canvas.freeDrawingBrush = brush;

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [imageData, projectId, navigate]);

  useEffect(() => {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = activeTool === "draw";
    fabricCanvas.selection = activeTool === "select";

    if (activeTool === "text") {
      const text = new IText("Text eingeben", {
        left: 100,
        top: 100,
        fill: "#ef4444",
        fontSize: 24,
        fontFamily: "Arial",
      });
      fabricCanvas.add(text);
      fabricCanvas.setActiveObject(text);
      text.enterEditing();
      setActiveTool("select");
    }
  }, [activeTool, fabricCanvas]);

  const handleCanvasClick = (e: any) => {
    if (activeTool !== "measure" || !fabricCanvas) return;

    const pointer = fabricCanvas.getPointer(e);

    if (!measureStart) {
      setMeasureStart({ x: pointer.x, y: pointer.y });
    } else {
      const measurement = prompt("Maß eingeben (in mm):");
      if (measurement) {
        const group = createMeasurementGroup(
          measureStart.x,
          measureStart.y,
          pointer.x,
          pointer.y,
          `${measurement} mm`,
          "#ef4444"
        );

        fabricCanvas.add(group);
        fabricCanvas.setActiveObject(group);
        fabricCanvas.renderAll();
        setTimeout(() => {
          fabricCanvas.renderAll();
        }, 50);
      }
      setMeasureStart(null);
      setActiveTool("select");
    }
  };

  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.on("mouse:down", handleCanvasClick);
      return () => {
        fabricCanvas.off("mouse:down", handleCanvasClick);
      };
    }
  }, [fabricCanvas, activeTool, measureStart]);

  const handleNext = () => {
    if (!fabricCanvas) return;

    // Ensure all objects are rendered before export
    fabricCanvas.renderAll();
    
    // Wait a moment to ensure rendering is complete
    setTimeout(() => {
      const dataUrl = fabricCanvas.toDataURL({
        format: "png",
        quality: 1,
        multiplier: 2,
      });

      navigate(`/projects/${projectId}/location-details`, {
        state: { imageData: dataUrl, originalImageData: imageData },
      });
    }, 200);
  };

  if (!imageData) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-card border-b p-4">
        <div className="container max-w-6xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Abbrechen
          </Button>

          <div className="flex gap-2">
            <Button
              variant={activeTool === "select" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("select")}
            >
              Auswählen
            </Button>
            <Button
              variant={activeTool === "draw" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("draw")}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTool === "text" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("text")}
            >
              <Type className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTool === "measure" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("measure")}
            >
              <Ruler className="h-4 w-4" />
            </Button>
          </div>

          <Button onClick={handleNext} size="sm">
            <Check className="h-4 w-4 mr-2" />
            Weiter
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <canvas ref={canvasRef} />
      </div>

      {measureStart && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg">
          Zweiten Punkt für Bemaßung wählen
        </div>
      )}
    </div>
  );
};

export default PhotoEditor;
