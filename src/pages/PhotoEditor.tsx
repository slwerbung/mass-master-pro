import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Canvas as FabricCanvas, PencilBrush, Line, IText, FabricImage } from "fabric";
import { Pencil, Type, Ruler, Undo, Redo, ArrowLeft, Check, Trash2 } from "lucide-react";
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
  const [canvasHistory, setCanvasHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const imageData = location.state?.imageData;

  useEffect(() => {
    if (!imageData) {
      toast.error("Kein Bild gefunden");
      navigate(`/projects/${projectId}`);
      return;
    }

    if (!canvasRef.current) return;

    // Calculate available space for canvas
    const headerHeight = window.innerWidth < 768 ? 100 : 80;
    const padding = window.innerWidth < 768 ? 8 : 32;
    const availableHeight = window.innerHeight - headerHeight - padding;
    const availableWidth = window.innerWidth - padding;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: availableWidth,
      height: availableHeight,
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

    // Save initial state
    canvas.on("object:added", saveHistory);
    canvas.on("object:modified", saveHistory);
    canvas.on("object:removed", saveHistory);

    setFabricCanvas(canvas);

    return () => {
      canvas.off("object:added", saveHistory);
      canvas.off("object:modified", saveHistory);
      canvas.off("object:removed", saveHistory);
      canvas.dispose();
    };
  }, [imageData, projectId, navigate]);

  const saveHistory = () => {
    if (!fabricCanvas) return;
    
    const json = JSON.stringify(fabricCanvas.toJSON());
    const newHistory = canvasHistory.slice(0, historyStep + 1);
    newHistory.push(json);
    setCanvasHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (!fabricCanvas || historyStep <= 0) return;
    
    const prevStep = historyStep - 1;
    setHistoryStep(prevStep);
    
    fabricCanvas.loadFromJSON(JSON.parse(canvasHistory[prevStep]), () => {
      fabricCanvas.renderAll();
    });
  };

  const handleRedo = () => {
    if (!fabricCanvas || historyStep >= canvasHistory.length - 1) return;
    
    const nextStep = historyStep + 1;
    setHistoryStep(nextStep);
    
    fabricCanvas.loadFromJSON(JSON.parse(canvasHistory[nextStep]), () => {
      fabricCanvas.renderAll();
    });
  };

  const handleDelete = () => {
    if (!fabricCanvas) return;
    
    const activeObjects = fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) {
      toast.error("Kein Objekt ausgewählt");
      return;
    }
    
    activeObjects.forEach((obj) => {
      fabricCanvas.remove(obj);
    });
    
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
    toast.success("Objekt gelöscht");
  };

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

    const p = (e && (e.absolutePointer || e.pointer)) ?? (e?.e ? fabricCanvas.getPointer(e.e) : null);
    if (!p) return;
    const pointer = { x: p.x, y: p.y };

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
        // added last, so it's already on top
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
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="shrink-0 bg-card border-b p-2">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex gap-1 justify-center flex-1">
            <Button
              variant={activeTool === "select" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("select")}
              className="px-2"
            >
              <span className="text-xs">Sel</span>
            </Button>
            <Button
              variant={activeTool === "draw" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("draw")}
              className="px-2"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTool === "text" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("text")}
              className="px-2"
            >
              <Type className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTool === "measure" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTool("measure")}
              className="px-2"
            >
              <Ruler className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={historyStep <= 0}
              className="px-2"
            >
              <Undo className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedo}
              disabled={historyStep >= canvasHistory.length - 1}
              className="px-2"
            >
              <Redo className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              className="px-2"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <Button onClick={handleNext} size="sm" className="shrink-0">
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-1">
        <canvas ref={canvasRef} className="max-w-full max-h-full" />
      </div>

      {measureStart && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground px-3 py-2 rounded-lg shadow-lg text-xs text-center z-50">
          Zweiten Punkt wählen
        </div>
      )}
    </div>
  );
};

export default PhotoEditor;
