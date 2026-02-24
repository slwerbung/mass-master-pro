import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Canvas as FabricCanvas, PencilBrush, Line, IText, FabricImage } from "fabric";
import { Pencil, Type, Ruler, Undo, Redo, ArrowLeft, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createMeasurementGroup } from "@/lib/measurement";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import MeasurementInputDialog from "@/components/MeasurementInputDialog";

type Tool = "select" | "draw" | "text" | "measure";

const PhotoEditor = () => {
  const { projectId, locationId, detailId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [showMeasureDialog, setShowMeasureDialog] = useState(false);
  const [canvasHistory, setCanvasHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [imageDataState, setImageDataState] = useState<string | null>(location.state?.imageData || null);
  const [loading, setLoading] = useState(false);

  const isReEdit = !!locationId;
  const isDetailReEdit = !!detailId;

  // Load image from IndexedDB for re-edit mode
  useEffect(() => {
    if (!isReEdit || imageDataState) return;
    const loadImage = async () => {
      setLoading(true);
      try {
        if (isDetailReEdit && locationId) {
          const details = await indexedDBStorage.getDetailImagesByLocation(locationId);
          const detail = details.find(d => d.id === detailId);
          if (detail) {
            setImageDataState(detail.imageData);
          } else {
            toast.error("Detailbild nicht gefunden");
            navigate(`/projects/${projectId}`);
          }
        } else if (locationId && projectId) {
          const project = await indexedDBStorage.getProject(projectId);
          const loc = project?.locations.find(l => l.id === locationId);
          if (loc) {
            setImageDataState(loc.imageData);
          } else {
            toast.error("Standort nicht gefunden");
            navigate(`/projects/${projectId}`);
          }
        }
      } catch (e) {
        console.error("Error loading image:", e);
        toast.error("Fehler beim Laden");
        navigate(`/projects/${projectId}`);
      } finally {
        setLoading(false);
      }
    };
    loadImage();
  }, [isReEdit, isDetailReEdit, locationId, detailId, projectId, navigate, imageDataState]);

  useEffect(() => {
    if (!imageDataState || !canvasRef.current) return;

    const headerHeight = window.innerWidth < 768 ? 100 : 80;
    const padding = window.innerWidth < 768 ? 8 : 32;
    const availableHeight = window.innerHeight - headerHeight - padding;
    const availableWidth = window.innerWidth - padding;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: availableWidth,
      height: availableHeight,
      backgroundColor: "#ffffff",
    });

    const img = new Image();
    img.onload = () => {
      const scale = Math.min(canvas.width! / img.width, canvas.height! / img.height);
      const fabricImage = new FabricImage(img, {
        scaleX: scale, scaleY: scale,
        originX: "center", originY: "center",
        left: canvas.width! / 2, top: canvas.height! / 2,
      });
      canvas.backgroundImage = fabricImage;
      canvas.renderAll();
    };
    img.src = imageDataState;

    const brush = new PencilBrush(canvas);
    brush.color = "#ef4444";
    brush.width = 3;
    canvas.freeDrawingBrush = brush;

    const saveHist = () => {
      const json = JSON.stringify(canvas.toJSON());
      setCanvasHistory(prev => {
        const newHistory = prev.slice(0, historyStep + 1);
        newHistory.push(json);
        return newHistory;
      });
      setHistoryStep(prev => prev + 1);
    };

    canvas.on("object:added", saveHist);
    canvas.on("object:modified", saveHist);
    canvas.on("object:removed", saveHist);
    setFabricCanvas(canvas);

    return () => {
      canvas.off("object:added", saveHist);
      canvas.off("object:modified", saveHist);
      canvas.off("object:removed", saveHist);
      canvas.dispose();
    };
  }, [imageDataState]);

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
    activeObjects.forEach((obj) => fabricCanvas.remove(obj));
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
        left: 100, top: 100, fill: "#ef4444", fontSize: 24, fontFamily: "Arial",
      });
      fabricCanvas.add(text);
      fabricCanvas.setActiveObject(text);
      text.enterEditing();
      setActiveTool("select");
    }
  }, [activeTool, fabricCanvas]);

  const handleCanvasClick = (e: any) => {
    if (activeTool !== "measure" || !fabricCanvas) return;
    const p = e?.scenePoint || e?.absolutePointer || e?.pointer;
    if (!p) return;
    const pointer = { x: p.x, y: p.y };

    if (!measureStart) {
      setMeasureStart({ x: pointer.x, y: pointer.y });
    } else {
      setMeasureEnd({ x: pointer.x, y: pointer.y });
      setShowMeasureDialog(true);
    }
  };

  const handleMeasureConfirm = (value: string) => {
    if (!fabricCanvas || !measureStart || !measureEnd) return;
    const group = createMeasurementGroup(
      measureStart.x, measureStart.y, measureEnd.x, measureEnd.y,
      `${value} mm`, "#ef4444"
    );
    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
    fabricCanvas.renderAll();
    setTimeout(() => fabricCanvas.renderAll(), 50);

    setShowMeasureDialog(false);
    setMeasureStart(null);
    setMeasureEnd(null);
    setActiveTool("select");
  };

  const handleMeasureCancel = () => {
    setShowMeasureDialog(false);
    setMeasureStart(null);
    setMeasureEnd(null);
    setActiveTool("select");
  };

  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.on("mouse:down", handleCanvasClick);
      return () => { fabricCanvas.off("mouse:down", handleCanvasClick); };
    }
  }, [fabricCanvas, activeTool, measureStart]);

  const handleNext = async () => {
    if (!fabricCanvas) return;
    fabricCanvas.renderAll();

    setTimeout(async () => {
      const dataUrl = fabricCanvas.toDataURL({ format: "png", quality: 1, multiplier: 2 });

      if (isReEdit && projectId) {
        try {
          if (isDetailReEdit && detailId) {
            await indexedDBStorage.updateDetailImage(detailId, dataUrl);
            toast.success("Detailbild aktualisiert");
          } else if (locationId) {
            await indexedDBStorage.updateLocationImage(projectId, locationId, dataUrl);
            toast.success("Bild aktualisiert");
          }
          navigate(`/projects/${projectId}`);
        } catch (e) {
          console.error("Error saving:", e);
          toast.error("Fehler beim Speichern");
        }
      } else {
        const detailParam = searchParams.get("detail");
        const locationIdParam = searchParams.get("locationId");
        const floorPlanParam = searchParams.get("floorPlan");
        let query = "";
        if (detailParam === "true" && locationIdParam) {
          query = `?detail=true&locationId=${locationIdParam}`;
        } else if (floorPlanParam && locationIdParam) {
          query = `?floorPlan=${floorPlanParam}&locationId=${locationIdParam}`;
        }
        navigate(`/projects/${projectId}/location-details${query}`, {
          state: { imageData: dataUrl, originalImageData: imageDataState },
        });
      }
    }, 200);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Bild wird geladen...</div>
      </div>
    );
  }

  if (!imageDataState) {
    if (!isReEdit) {
      toast.error("Kein Bild gefunden");
      navigate(`/projects/${projectId}`);
    }
    return null;
  }

  return (
    <div className="app-screen bg-background flex flex-col overflow-hidden">
      <div className="shrink-0 bg-card border-b p-2">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectId}`)} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex gap-1 justify-center flex-1">
            <Button variant={activeTool === "select" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("select")} className="px-2">
              <span className="text-xs">Ausw.</span>
            </Button>
            <Button variant={activeTool === "draw" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("draw")} className="px-2">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant={activeTool === "text" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("text")} className="px-2">
              <Type className="h-4 w-4" />
            </Button>
            <Button variant={activeTool === "measure" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("measure")} className="px-2">
              <Ruler className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleUndo} disabled={historyStep <= 0} className="px-2">
              <Undo className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleRedo} disabled={historyStep >= canvasHistory.length - 1} className="px-2">
              <Redo className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} className="px-2">
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

      {measureStart && !showMeasureDialog && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground px-3 py-2 rounded-lg shadow-lg text-xs text-center z-50">
          Zweiten Punkt wählen
        </div>
      )}

      <MeasurementInputDialog
        open={showMeasureDialog}
        onConfirm={handleMeasureConfirm}
        onCancel={handleMeasureCancel}
      />
    </div>
  );
};

export default PhotoEditor;
