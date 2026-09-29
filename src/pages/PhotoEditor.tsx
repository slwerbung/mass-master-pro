import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Canvas as FabricCanvas, PencilBrush, Line, IText, FabricImage, Point, Shadow } from "fabric";
import { Pencil, Type, Ruler, Undo, Redo, ArrowLeft, Check, Trash2, RectangleHorizontal, Copy, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { toast } from "sonner";
import { createMeasurementGroup } from "@/lib/measurement";
import { createAreaMeasurementGroup, renderAreaLabels } from "@/lib/areaMeasurement";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { supabase } from "@/integrations/supabase/client";
import { signedFileUrl } from "@/lib/storageUrl";
import { enqueueHeroUploadIfLinked, dataUrlToBlob } from "@/lib/heroSyncHelpers";
import { updateHeroNotesIfLinked } from "@/lib/heroNotesSync";
import MeasurementInputDialog from "@/components/MeasurementInputDialog";
import AreaMeasurementDialog from "@/components/AreaMeasurementDialog";
import { setEditorHandoff, takeEditorHandoff, setMeasuredResult } from "@/lib/editorHandoff";
import { cameraStage, cameraFinished } from "@/lib/cameraGuard";
import {
  getCapture, noteEditorLoad, noteEditorShown, saveCaptureDraft, saveCaptureResult, clearCapture,
  currentPath,
} from "@/lib/captureSession";
import { readImageFileForEditor } from "@/lib/imageFile";

type Tool = "select" | "draw" | "text" | "measure" | "area";

// ── View (zoom / pan / resize) ────────────────────────────────────────────
// Everything on the canvas lives in fixed "scene" coordinates: the photo is
// laid out once when the editor opens, and every line, label and area is
// stored relative to it. Zooming, panning and rotating the phone only change
// the viewport transform on top of that, so annotations never move relative
// to the photo and the export (done at the identity viewport) is always the
// whole photo – no matter how far the user is zoomed in.

/** Photo rectangle in scene coordinates (the background is centred). */
function photoSceneRect(canvas: FabricCanvas): { left: number; top: number; width: number; height: number } | null {
  const bg: any = canvas.backgroundImage;
  if (!bg || typeof bg.width !== "number" || typeof bg.height !== "number") return null;
  const width = bg.width * (bg.scaleX ?? 1);
  const height = bg.height * (bg.scaleY ?? 1);
  return { left: (bg.left ?? 0) - width / 2, top: (bg.top ?? 0) - height / 2, width, height };
}

/** Zoom at which the whole photo fits the current canvas size. */
function fitZoomFor(canvas: FabricCanvas): number {
  const r = photoSceneRect(canvas);
  if (!r || r.width <= 0 || r.height <= 0) return 1;
  return Math.min(canvas.getWidth() / r.width, canvas.getHeight() / r.height);
}

/**
 * Keeps the photo in view: when it is smaller than the canvas on an axis it is
 * centred on that axis, when it is larger there are no empty margins – so the
 * picture can never be pushed out of sight or appear cut off.
 */
function constrainView(canvas: FabricCanvas) {
  const r = photoSceneRect(canvas);
  if (!r) return;
  const vpt = [...canvas.viewportTransform] as [number, number, number, number, number, number];
  const z = vpt[0];
  const W = canvas.getWidth(), H = canvas.getHeight();
  const vw = z * r.width, vh = z * r.height;
  vpt[4] = vw <= W ? (W - vw) / 2 - z * r.left : Math.min(-z * r.left, Math.max(W - z * (r.left + r.width), vpt[4]));
  vpt[5] = vh <= H ? (H - vh) / 2 - z * r.top : Math.min(-z * r.top, Math.max(H - z * (r.top + r.height), vpt[5]));
  canvas.setViewportTransform(vpt);
}

/** Show the whole photo, centred. */
function fitView(canvas: FabricCanvas) {
  const z = fitZoomFor(canvas);
  canvas.setViewportTransform([z, 0, 0, z, 0, 0]);
  constrainView(canvas);
  canvas.requestRenderAll();
}

// Zoom range relative to "whole photo visible".
const MIN_ZOOM_FACTOR = 1;
const MAX_ZOOM_FACTOR = 8;

/** Zoom around a point in canvas (viewport) pixels, clamped and kept in view. */
function zoomAt(canvas: FabricCanvas, point: Point, nextZoom: number) {
  const fit = fitZoomFor(canvas);
  const z = Math.max(fit * MIN_ZOOM_FACTOR, Math.min(fit * MAX_ZOOM_FACTOR, nextZoom));
  canvas.zoomToPoint(point, z);
  constrainView(canvas);
  canvas.requestRenderAll();
}

const PhotoEditor = () => {
  const { projectId, locationId, detailId, measuredId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [showMeasureDialog, setShowMeasureDialog] = useState(false);
  const [areaStart, setAreaStart] = useState<{ x: number; y: number } | null>(null);
  const [areaEnd, setAreaEnd] = useState<{ x: number; y: number } | null>(null);
  const [showAreaDialog, setShowAreaDialog] = useState(false);
  const [canvasHistory, setCanvasHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const historyRef = useRef<string[]>([]);
  const historyStepRef = useRef(-1);
  const isRestoringHistoryRef = useRef(false);
  // Guard so the derived area-label objects (added/removed by renderAreaLabels)
  // never push their own history states or re-trigger a relayout.
  const isRenderingLabelsRef = useRef(false);
  // Incoming capture arrives via the in-memory hand-off (see editorHandoff.ts);
  // fall back to router state for any legacy/edge navigations. Always consume
  // (clear) the hand-off on mount, but only USE it for a fresh capture — a
  // re-edit loads its image from IndexedDB/Storage instead.
  const [imageDataState, setImageDataState] = useState<string | null>(() => {
    const handoff = takeEditorHandoff();
    if (location.state?.imageData) return location.state.imageData;
    const reEdit = !!locationId || !!measuredId;
    return reEdit ? null : (handoff?.imageData ?? null);
  });
  // A NEW photo (not re-editing a saved one) is backed by the durable capture
  // session (captureSession.ts): without an in-memory hand-off – e.g. after
  // the app was restarted – the photo and the measurements drawn so far are
  // loaded from there instead of giving up with "Kein Bild gefunden".
  const isFreshCapture = !locationId && !measuredId;
  const captureActiveRef = useRef(false);
  const pendingDraftRef = useRef<string | null>(null);
  const draftTimerRef = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(() => isFreshCapture && !imageDataState);
  const [savedMaxAreaIndex, setSavedMaxAreaIndex] = useState(0);
  const pinchStateRef = useRef<{ initialDistance: number; initialZoom: number; isPinching: boolean; lastMid: { x: number; y: number } }>({ initialDistance: 0, initialZoom: 1, isPinching: false, lastMid: { x: 0, y: 0 } });
  // Wrapper around the canvas; its size is what the canvas may occupy.
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const suppressTapUntilRef = useRef(0);

  const isReEdit = !!locationId || !!measuredId;
  const isDetailReEdit = !!detailId;
  // Vehicle "Bilder bemaßt" re-edit: load image from Supabase Storage
  // (not IndexedDB like the Aufmaß flow), and on save update the same
  // database row + storage path instead of inserting a new row.
  const isVehicleMeasuredReEdit = !!measuredId;

  // Keep the overlay (lines, areas, text – not the photo) in the capture
  // session, so a restart resumes with everything drawn so far. Debounced:
  // one write after the user pauses, not one per stroke.
  const scheduleDraftSave = (json: string) => {
    if (!captureActiveRef.current) return;
    window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => { void saveCaptureDraft(json); }, 600);
  };

  const pushHistoryState = useCallback((canvas: FabricCanvas) => {
    if (isRestoringHistoryRef.current || isRenderingLabelsRef.current) return;
    // Include custom `data` so area metadata (and thus the measurements) survive
    // undo/redo; without it a restored canvas loses every area's dimensions.
    // toObject(propertiesToInclude) is the Fabric-v7 way to add custom props.
    const obj: any = canvas.toObject(["data"]);
    // MEMORY: never store the full-resolution background photo in the undo
    // history. The user only ever draws ON TOP of a fixed background, so each
    // snapshot only needs the vector overlay. Keeping the multi-hundred-KB image
    // data-URL in every history entry piled up until mobile browsers ran out of
    // memory ("zu wenig Speicher"). The live background is re-applied on restore.
    delete obj.backgroundImage;
    delete obj.background;
    const json = JSON.stringify(obj);
    const nextHistory = historyRef.current.slice(0, historyStepRef.current + 1);
    if (nextHistory[nextHistory.length - 1] === json) return;
    nextHistory.push(json);
    // Bound the history so a long editing session can't grow without limit.
    const MAX_HISTORY = 40;
    if (nextHistory.length > MAX_HISTORY) nextHistory.splice(0, nextHistory.length - MAX_HISTORY);
    historyRef.current = nextHistory;
    historyStepRef.current = nextHistory.length - 1;
    setCanvasHistory(nextHistory);
    setHistoryStep(historyStepRef.current);
    scheduleDraftSave(json);
  }, []);

  const restoreHistoryStep = useCallback((step: number) => {
    if (!fabricCanvas || !historyRef.current[step]) return;
    isRestoringHistoryRef.current = true;
    historyStepRef.current = step;
    setHistoryStep(step);
    // History no longer carries the background photo, so hold on to the live one
    // and re-apply it after loadFromJSON (which would otherwise clear it).
    const bg = fabricCanvas.backgroundImage;
    scheduleDraftSave(historyRef.current[step]);
    fabricCanvas.loadFromJSON(historyRef.current[step]).then(() => {
      if (bg) fabricCanvas.backgroundImage = bg;
      // Derived labels are not stored in history — re-derive them for the
      // restored set of areas (also guarantees they stay non-overlapping).
      relayoutLabels(fabricCanvas);
      fabricCanvas.renderAll();
      isRestoringHistoryRef.current = false;
    }).catch((error) => {
      console.error("History restore failed:", error);
      isRestoringHistoryRef.current = false;
    });
  }, [fabricCanvas]);

  // Rebuild all area labels so none overlap. Guarded so the label objects it
  // adds/removes don't recurse back into history or another relayout.
  const relayoutLabels = useCallback((canvas: FabricCanvas | null) => {
    if (!canvas) return;
    isRenderingLabelsRef.current = true;
    try {
      renderAreaLabels(canvas, "#3b82f6");
    } finally {
      isRenderingLabelsRef.current = false;
    }
    canvas.requestRenderAll();
  }, []);

  useEffect(() => {
    if (!isReEdit || imageDataState) return;
    const loadImage = async () => {
      setLoading(true);
      try {
        if (isVehicleMeasuredReEdit && measuredId && projectId) {
          // Load the bemaßt (drawn-on) image from Supabase Storage and
          // use it as the canvas background. User will draw further
          // strokes on top — same UX as detail re-edit in Aufmaß.
          const { data: row, error } = await supabase
            .from("vehicle_measured_images")
            .select("storage_path")
            .eq("id", measuredId)
            .maybeSingle();
          if (error || !row) {
            toast.error("Bemaßtes Bild nicht gefunden");
            navigate(`/projects/${projectId}/vehicle`);
            return;
          }
          // Convert the signed URL to a data URL the Fabric canvas can
          // load synchronously. fetch->blob->FileReader pattern matches
          // what compressImage and other paths in the app already do.
          const signed = await signedFileUrl(row.storage_path);
          if (!signed) {
            toast.error("Bemaßtes Bild nicht abrufbar");
            navigate(`/projects/${projectId}/vehicle`);
            return;
          }
          const resp = await fetch(signed);
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          setImageDataState(dataUrl);
        } else if (isDetailReEdit && locationId) {
          const details = await indexedDBStorage.getDetailImagesByLocation(locationId);
          const detail = details.find(d => d.id === detailId);
          if (detail) setImageDataState(detail.imageData);
          else { toast.error("Detailbild nicht gefunden"); navigate(`/projects/${projectId}`); }
        } else if (locationId && projectId) {
          const project = await indexedDBStorage.getProject(projectId);
          const loc = project?.locations.find(l => l.id === locationId);
          if (loc) setImageDataState(loc.imageData);
          else { toast.error("Standort nicht gefunden"); navigate(`/projects/${projectId}`); }
        }
      } catch (e) {
        console.error("Error loading image:", e);
        toast.error("Fehler beim Laden");
        navigate(`/projects/${projectId}`);
      } finally { setLoading(false); }
    };
    loadImage();
  }, [isReEdit, isDetailReEdit, isVehicleMeasuredReEdit, locationId, detailId, measuredId, projectId, navigate, imageDataState]);

  // Space available for the canvas (the flex area below the toolbar).
  const measureCanvasArea = () => {
    const el = canvasAreaRef.current;
    const w = el ? el.clientWidth - 8 : window.innerWidth - 8;
    const h = el ? el.clientHeight - 8 : window.innerHeight - 100;
    return { width: Math.max(120, Math.floor(w)), height: Math.max(120, Math.floor(h)) };
  };

  useEffect(() => {
    if (!imageDataState || !canvasRef.current) return;
    const { width: availableWidth, height: availableHeight } = measureCanvasArea();

    const canvas = new FabricCanvas(canvasRef.current, {
      width: availableWidth, height: availableHeight, backgroundColor: "#ffffff",
    });

    const img = new Image();
    const brush = new PencilBrush(canvas);
    brush.color = "#ef4444"; brush.width = 3;
    canvas.freeDrawingBrush = brush;

    const saveHist = () => pushHistoryState(canvas);
    canvas.on("object:added", saveHist);
    canvas.on("object:modified", saveHist);
    canvas.on("object:removed", saveHist);

    // Keep area labels non-overlapping after any change to real objects
    // (adding/moving/deleting an area). Ignore the derived label/leader objects
    // themselves and skip while a relayout is in progress, to avoid recursion.
    const onMutate = (e: any) => {
      if (isRenderingLabelsRef.current) return;
      const t = e?.target;
      if (t?.data?.type === "area-label" || t?.data?.type === "area-leader") return;
      try { relayoutLabels(canvas); } catch (err) { console.warn("relayout failed:", err); }
    };
    canvas.on("object:added", onMutate);
    canvas.on("object:modified", onMutate);
    canvas.on("object:removed", onMutate);
    setFabricCanvas(canvas);

    cameraStage("editor", { editorImageBytes: imageDataState.length });
    img.onload = () => {
      const scale = Math.min(canvas.width! / img.width, canvas.height! / img.height);
      const fabricImage = new FabricImage(img, {
        scaleX: scale, scaleY: scale, originX: "center", originY: "center",
        left: canvas.width! / 2, top: canvas.height! / 2,
      });
      canvas.backgroundImage = fabricImage;
      fitView(canvas);
      // The photo is on screen: a camera round trip (if any) completed.
      cameraFinished();
      if (captureActiveRef.current) void noteEditorShown();
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (!draft) { pushHistoryState(canvas); return; }
      // Resuming after a restart: put back what was drawn before.
      isRestoringHistoryRef.current = true;
      canvas.loadFromJSON(draft).then(() => {
        canvas.backgroundImage = fabricImage;
        try { relayoutLabels(canvas); } catch { /* labels are cosmetic */ }
        canvas.renderAll();
      }).catch((e) => console.warn("draft restore failed:", e)).finally(() => {
        isRestoringHistoryRef.current = false;
        pushHistoryState(canvas);
      });
    };
    img.src = imageDataState;

    return () => {
      canvas.off("object:added", saveHist);
      canvas.off("object:modified", saveHist);
      canvas.off("object:removed", saveHist);
      canvas.off("object:added", onMutate);
      canvas.off("object:modified", onMutate);
      canvas.off("object:removed", onMutate);
      canvas.dispose();
      historyRef.current = []; historyStepRef.current = -1;
      setCanvasHistory([]); setHistoryStep(-1);
    };
  }, [imageDataState]);

  const handleUndo = () => { if (historyStepRef.current <= 0) return; restoreHistoryStep(historyStepRef.current - 1); };
  const handleRedo = () => { if (historyStepRef.current >= historyRef.current.length - 1) return; restoreHistoryStep(historyStepRef.current + 1); };

  const handleDelete = () => {
    if (!fabricCanvas) return;
    const activeObjects = fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) { toast.error("Kein Objekt ausgewählt"); return; }
    activeObjects.forEach((obj) => fabricCanvas.remove(obj));
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
    toast.success("Objekt gelöscht");
  };

  useEffect(() => {
    if (!fabricCanvas) return;
    fabricCanvas.isDrawingMode = activeTool === "draw";
    fabricCanvas.selection = activeTool === "select";
  }, [activeTool, fabricCanvas]);

  // Insert a text box in the CENTER of the current view and immediately start
  // editing so the mobile keyboard opens (must run inside the button tap
  // gesture). The placeholder is pre-selected, so the first keystroke replaces
  // it; if the user types nothing, the empty placeholder is removed again. A
  // dark outline + shadow keep the text legible on any background.
  const PLACEHOLDER = "Text eingeben";
  const addText = () => {
    if (!fabricCanvas) return;
    setActiveTool("select");
    const c: any = (fabricCanvas as any).getVpCenter
      ? (fabricCanvas as any).getVpCenter()
      : new Point(fabricCanvas.getWidth() / 2, fabricCanvas.getHeight() / 2);
    const fontSize = 30;
    const text = new IText(PLACEHOLDER, {
      left: c.x, top: c.y, originX: "center", originY: "center",
      fill: "#ef4444", fontSize, fontFamily: "Arial", fontWeight: "bold",
      stroke: "#000000", strokeWidth: Math.max(1, fontSize * 0.06), paintFirst: "stroke",
      shadow: new Shadow({ color: "rgba(0,0,0,0.85)", blur: 4, offsetX: 0, offsetY: 1 }),
    });
    // @ts-ignore
    text.data = { placeholder: true };
    text.on("changed", () => {
      // @ts-ignore
      if (text.data?.placeholder) text.data.placeholder = false;
    });
    text.on("editing:exited", () => {
      const val = (text.text || "").trim();
      // @ts-ignore
      if (val === "" || (text.data?.placeholder && val === PLACEHOLDER)) {
        fabricCanvas.remove(text);
        fabricCanvas.requestRenderAll();
      }
    });
    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    (text as any).hiddenTextarea?.focus();
    fabricCanvas.requestRenderAll();
  };

  const handleCanvasClick = (e: any) => {
    if (!fabricCanvas) return;
    if (Date.now() < suppressTapUntilRef.current || pinchStateRef.current.isPinching) return;

    let pointer: { x: number; y: number } | null = null;
    if (fabricCanvas && e?.e) {
      try {
        const sp = fabricCanvas.getScenePoint(e.e);
        pointer = { x: sp.x, y: sp.y };
      } catch {}
    }
    if (!pointer) {
      const p = e?.scenePoint || e?.absolutePointer || e?.pointer;
      if (!p) return;
      pointer = { x: p.x, y: p.y };
    }

    if (activeTool === "measure") {
      if (!measureStart) {
        setMeasureStart(pointer);
      } else {
        setMeasureEnd(pointer);
        setShowMeasureDialog(true);
      }
    } else if (activeTool === "area") {
      if (!areaStart) {
        setAreaStart(pointer);
      } else {
        setAreaEnd(pointer);
        setShowAreaDialog(true);
      }
    }
  };

  const duplicateAreaGroup = (sourceGroup: any) => {
    if (!fabricCanvas) return;
    const data = sourceGroup?.data;
    if (!data || data.type !== "area") return;

    const w = sourceGroup.width * (sourceGroup.scaleX ?? 1);
    const h = sourceGroup.height * (sourceGroup.scaleY ?? 1);
    const srcLeft = sourceGroup.left ?? 0;
    const srcTop = sourceGroup.top ?? 0;

    // Place the copy directly to the right of the source with a small
    // gap so it's visibly distinct. If that would push it off-canvas,
    // place it below instead.
    const gap = 8;
    let newLeft = srcLeft + w + gap;
    let newTop = srcTop;
    const canvasW = fabricCanvas.getWidth();
    if (newLeft + w > canvasW) {
      newLeft = srcLeft;
      newTop = srcTop + h + gap;
    }

    const index = getNextAreaIndex();
    const copy = createAreaMeasurementGroup(
      newLeft,
      newTop,
      newLeft + w,
      newTop + h,
      data.widthMm,
      data.heightMm,
      index,
      "#3b82f6"
    );
    fabricCanvas.add(copy);
    fabricCanvas.setActiveObject(copy);
    fabricCanvas.renderAll();
    setTimeout(() => fabricCanvas.renderAll(), 50);
  };

  // Double-click on an area duplicates it. Quick way to stamp out
  // multiple same-size surfaces (e.g. several identical window panels
  // in a row) without re-entering the dimensions every time.
  const handleAreaDoubleClick = (e: any) => {
    const target = e?.target;
    if (target?.data?.type === "area") {
      duplicateAreaGroup(target);
    }
  };

  // Track which area is currently selected so the toolbar can show
  // the "Duplizieren" button only when an area is active.
  const [selectedAreaGroup, setSelectedAreaGroup] = useState<any>(null);

  useEffect(() => {
    if (!fabricCanvas) return;
    const onSelect = (e: any) => {
      const target = e?.selected?.[0] || fabricCanvas.getActiveObject();
      if (target?.data?.type === "area") setSelectedAreaGroup(target);
      else setSelectedAreaGroup(null);
    };
    const onClear = () => setSelectedAreaGroup(null);
    fabricCanvas.on("selection:created", onSelect);
    fabricCanvas.on("selection:updated", onSelect);
    fabricCanvas.on("selection:cleared", onClear);
    fabricCanvas.on("mouse:dblclick", handleAreaDoubleClick);
    return () => {
      fabricCanvas.off("selection:created", onSelect);
      fabricCanvas.off("selection:updated", onSelect);
      fabricCanvas.off("selection:cleared", onClear);
      fabricCanvas.off("mouse:dblclick", handleAreaDoubleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricCanvas]);

  const handleMeasureConfirm = (value: string) => {
    if (!fabricCanvas || !measureStart || !measureEnd) return;
    const group = createMeasurementGroup(measureStart.x, measureStart.y, measureEnd.x, measureEnd.y, `${value} mm`, "#ef4444");
    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
    fabricCanvas.renderAll();
    setTimeout(() => fabricCanvas.renderAll(), 50);
    setShowMeasureDialog(false); setMeasureStart(null); setMeasureEnd(null); setActiveTool("select");
  };

  const handleMeasureCancel = () => {
    setShowMeasureDialog(false); setMeasureStart(null); setMeasureEnd(null); setActiveTool("select");
  };

  // Load the max area measurement index across ALL project locations so new
  // areas continue the numbering project-wide instead of restarting at 1.
  useEffect(() => {
    if (!projectId) return;
    indexedDBStorage.getProject(projectId).then(proj => {
      if (!proj) return;
      let max = 0;
      for (const loc of proj.locations) {
        if (loc.areaMeasurements && loc.areaMeasurements.length > 0) {
          const locMax = Math.max(...loc.areaMeasurements.map(m => m.index));
          if (locMax > max) max = locMax;
        }
      }
      setSavedMaxAreaIndex(max);
    });
  }, [projectId]);

  const getNextAreaIndex = () => {
    let max = savedMaxAreaIndex;
    if (fabricCanvas) {
      fabricCanvas.getObjects().forEach((obj: any) => {
        if (obj.data?.type === "area" && obj.data.index > max) max = obj.data.index;
      });
    }
    return max + 1;
  };

  const handleAreaConfirm = (widthMm: number, heightMm: number) => {
    if (!fabricCanvas || !areaStart || !areaEnd) return;
    const index = getNextAreaIndex();
    const group = createAreaMeasurementGroup(areaStart.x, areaStart.y, areaEnd.x, areaEnd.y, widthMm, heightMm, index, "#3b82f6");
    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
    fabricCanvas.renderAll();
    setTimeout(() => fabricCanvas.renderAll(), 50);
    setShowAreaDialog(false); setAreaStart(null); setAreaEnd(null); setActiveTool("select");
  };

  const handleAreaCancel = () => {
    setShowAreaDialog(false); setAreaStart(null); setAreaEnd(null); setActiveTool("select");
  };

  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.on("mouse:down", handleCanvasClick);
      return () => { fabricCanvas.off("mouse:down", handleCanvasClick); };
    }
  }, [fabricCanvas, activeTool, measureStart, areaStart]);


  useEffect(() => {
    if (!fabricCanvas) return;

    const target = fabricCanvas.upperCanvasEl;
    if (!target) return;

    target.style.touchAction = "none";
    if (fabricCanvas.lowerCanvasEl) fabricCanvas.lowerCanvasEl.style.touchAction = "none";

    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const getMidpoint = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      pinchStateRef.current = {
        initialDistance: getDistance(event.touches),
        initialZoom: fabricCanvas.getZoom(),
        isPinching: true,
        lastMid: getMidpoint(event.touches),
      };
      suppressTapUntilRef.current = Date.now() + 250;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchStateRef.current.isPinching) return;
      event.preventDefault();
      const currentDistance = getDistance(event.touches);
      const scale = currentDistance / Math.max(pinchStateRef.current.initialDistance, 1);
      const midpoint = getMidpoint(event.touches);
      const rect = target.getBoundingClientRect();
      // Two fingers zoom AND move the picture: follow the midpoint, then zoom
      // around it. Without the pan, zoomed-in parts were unreachable.
      const last = pinchStateRef.current.lastMid;
      fabricCanvas.relativePan(new Point(midpoint.x - last.x, midpoint.y - last.y));
      pinchStateRef.current.lastMid = midpoint;
      zoomAt(fabricCanvas, new Point(midpoint.x - rect.left, midpoint.y - rect.top), pinchStateRef.current.initialZoom * scale);
      suppressTapUntilRef.current = Date.now() + 250;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2 && pinchStateRef.current.isPinching) {
        pinchStateRef.current.isPinching = false;
        suppressTapUntilRef.current = Date.now() + 250;
      }
    };

    target.addEventListener("touchstart", handleTouchStart, { passive: false });
    target.addEventListener("touchmove", handleTouchMove, { passive: false });
    target.addEventListener("touchend", handleTouchEnd, { passive: false });
    target.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    return () => {
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("touchend", handleTouchEnd);
      target.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [fabricCanvas]);

  // Zoom around the middle of the visible area (toolbar buttons).
  const zoomBy = (factor: number) => {
    if (!fabricCanvas) return;
    zoomAt(fabricCanvas, new Point(fabricCanvas.getWidth() / 2, fabricCanvas.getHeight() / 2), fabricCanvas.getZoom() * factor);
  };

  // Rotating the phone (or resizing the window) resizes the canvas to the new
  // space and shows the whole photo again. Annotations keep their place on the
  // photo because only the viewport changes.
  useEffect(() => {
    if (!fabricCanvas) return;
    let timer: number | undefined;
    const apply = () => {
      const { width, height } = measureCanvasArea();
      if (width === fabricCanvas.getWidth() && height === fabricCanvas.getHeight()) return;
      fabricCanvas.setDimensions({ width, height });
      fitView(fabricCanvas);
    };
    // Wait for the layout to settle (iOS reports the old size right after
    // an orientation change).
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => requestAnimationFrame(apply), 150);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [fabricCanvas]);

  // Desktop: mouse wheel / trackpad pinch zooms at the cursor; dragging with
  // the space bar held or the middle mouse button moves the picture.
  useEffect(() => {
    if (!fabricCanvas) return;
    const onWheel = (opt: any) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      const factor = Math.pow(0.998, e.deltaY);
      zoomAt(fabricCanvas, fabricCanvas.getViewportPoint(e), fabricCanvas.getZoom() * factor);
    };
    fabricCanvas.on("mouse:wheel", onWheel);

    const host = fabricCanvas.upperCanvasEl?.parentElement;
    let spaceHeld = false;
    let panning: { x: number; y: number } | null = null;
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
    };
    // Space is only the pan modifier here. Swallow it (down AND up) so it
    // never "clicks" a focused toolbar button – e.g. the back arrow, which
    // would leave the editor without saving.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping()) return;
      e.preventDefault();
      spaceHeld = true;
      if (host) host.style.cursor = "grab";
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceHeld) return;
      e.preventDefault();
      spaceHeld = false;
      if (host && !panning) host.style.cursor = "";
    };
    // Capture phase on the wrapper runs before Fabric's own listeners on the
    // canvas, so a pan drag never draws, selects or measures.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!(e.button === 1 || (e.button === 0 && spaceHeld))) return;
      e.preventDefault();
      e.stopPropagation();
      panning = { x: e.clientX, y: e.clientY };
      if (host) host.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!panning) return;
      e.preventDefault();
      e.stopPropagation();
      fabricCanvas.relativePan(new Point(e.clientX - panning.x, e.clientY - panning.y));
      constrainView(fabricCanvas);
      fabricCanvas.requestRenderAll();
      panning = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!panning) return;
      e.preventDefault();
      e.stopPropagation();
      panning = null;
      if (host) host.style.cursor = spaceHeld ? "grab" : "";
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    host?.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      fabricCanvas.off("mouse:wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      host?.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [fabricCanvas]);

  const handleNext = async () => {
    if (!fabricCanvas) return;
    fabricCanvas.renderAll();

    setTimeout(async () => {
      try {
        const bg: any = fabricCanvas.backgroundImage as any;
        // Export the annotated image at the photo's NATIVE resolution
        // without lossy downscaling. The drawn-on dimension lines and
        // labels must stay crisp - the old behavior downscaled to 1600px
        // which made them small and blurry. We map the on-screen (scaled)
        // canvas back up to the background photo's real pixel size.
        const bgScale = (bg && typeof bg.scaleX === "number" && bg.scaleX > 0) ? bg.scaleX : 1;
        const nativeMultiplier = Math.min(Math.max(1 / bgScale, 1), 4);
        let exportOptions: any = { format: "jpeg", quality: 0.95, multiplier: nativeMultiplier };
        // The crop box is the whole photo in SCENE coordinates. toDataURL crops
        // in viewport coordinates, so the export runs at the identity viewport
        // (see below) – otherwise a zoomed-in or rotated view would be saved
        // cut off. Deliberately not clamped to the canvas size: after rotating
        // the phone the canvas can be smaller than the scene.
        const photo = photoSceneRect(fabricCanvas);
        if (photo) {
          exportOptions = {
            ...exportOptions,
            left: photo.left,
            top: photo.top,
            width: Math.max(1, photo.width),
            height: Math.max(1, photo.height),
          };
        }

        // MEMORY: cap the exported bitmap so the temporary export canvas can't
        // balloon (multiplier × crop) and OOM a phone. 2600px longest side keeps
        // dimension labels crisp while staying well within mobile limits.
        {
          const outW = (exportOptions.width ?? fabricCanvas.getWidth()) * (exportOptions.multiplier ?? 1);
          const outH = (exportOptions.height ?? fabricCanvas.getHeight()) * (exportOptions.multiplier ?? 1);
          const outLongest = Math.max(outW, outH);
          const MAX_OUT = 2600;
          if (outLongest > MAX_OUT) exportOptions.multiplier = (exportOptions.multiplier ?? 1) * (MAX_OUT / outLongest);
        }
        const viewBefore = [...fabricCanvas.viewportTransform] as typeof fabricCanvas.viewportTransform;
        let dataUrl: string;
        try {
          fabricCanvas.viewportTransform = [1, 0, 0, 1, 0, 0];
          dataUrl = fabricCanvas.toDataURL(exportOptions);
        } finally {
          fabricCanvas.setViewportTransform(viewBefore);
        }
        // No compressImage() here on purpose - annotated images stay at
        // full resolution so dimension labels remain sharp. (Originals
        // are still lightly compressed in supabaseSync, annotated are not.)

        // Extract area measurements from canvas objects
        const areaMeasurements: { index: number; widthMm: number; heightMm: number }[] = [];
        fabricCanvas.getObjects().forEach((obj: any) => {
          if (obj.data?.type === "area") {
            areaMeasurements.push({
              index: obj.data.index,
              widthMm: obj.data.widthMm,
              heightMm: obj.data.heightMm,
            });
          }
        });

        if (isReEdit && projectId) {
          try {
            if (isVehicleMeasuredReEdit && measuredId) {
              // Strategy: upload to a brand new path, update the DB row
              // to point at it, then best-effort delete the old file.
              // We don't use upsert because the storage UPDATE policies
              // here block re-uploading to an existing path with anon
              // credentials. Going the new-path route also gives us a
              // tiny safety net: if the DB update fails after the
              // upload, the old image is still there and intact.
              const { data: row } = await supabase
                .from("vehicle_measured_images")
                .select("storage_path, project_id")
                .eq("id", measuredId)
                .maybeSingle();
              if (!row) throw new Error("Bemaßtes Bild nicht gefunden");

              const blob = dataUrlToBlob(dataUrl);
              const newPath = `vehicle-measured-images/${row.project_id}/${crypto.randomUUID()}-bemasst.jpg`;
              const { error: upErr } = await supabase.storage
                .from("project-files")
                .upload(newPath, blob, { contentType: "image/jpeg" });
              if (upErr) throw upErr;

              // Point the DB row at the new file
              const { error: updErr } = await supabase
                .from("vehicle_measured_images")
                .update({ storage_path: newPath })
                .eq("id", measuredId);
              if (updErr) throw updErr;

              // Best-effort delete of the old file. If this fails, we
              // log and move on - a stale file in storage isn't worth
              // failing the user-facing save flow over.
              const oldPath = row.storage_path;
              if (oldPath && oldPath !== newPath) {
                supabase.storage.from("project-files").remove([oldPath])
                  .catch(e => console.warn("Old file cleanup failed:", e));
              }

              // Mirror to HERO. Original isn't re-uploaded - users only
              // edit the bemaßt version, the original in HERO is still
              // valid. Filename includes a timestamp so it doesn't
              // collide with prior uploads of this same image.
              const { data: proj } = await supabase
                .from("projects")
                .select("id, custom_fields")
                .eq("id", row.project_id)
                .maybeSingle();
              if (proj) {
                await enqueueHeroUploadIfLinked({
                  project: { id: proj.id, customFields: proj.custom_fields as any },
                  uploadType: "vehicle_measured_image",
                  blob,
                  filename: `bemasst-${measuredId.slice(0, 8)}-rev-${Date.now()}.jpg`,
                });
              }

              toast.success("Bemaßtes Bild aktualisiert");
              navigate(`/projects/${projectId}/vehicle`);
              return;
            } else if (isDetailReEdit && detailId) {
              await indexedDBStorage.updateDetailImage(detailId, dataUrl);
              toast.success("Detailbild aktualisiert");
            } else if (locationId) {
              await indexedDBStorage.updateLocationImage(projectId, locationId, dataUrl);
              // Merge new area measurements with existing
              const project = await indexedDBStorage.getProject(projectId);
              const existingLoc = project?.locations.find(l => l.id === locationId);
              const existingMeasurements = existingLoc?.areaMeasurements || [];
              const mergedMeasurements = [...existingMeasurements, ...areaMeasurements];
              if (mergedMeasurements.length > 0) {
                await indexedDBStorage.updateLocationMetadata(projectId, locationId, { areaMeasurements: mergedMeasurements });
                // Sync the consolidated area measurements into HERO's
                // project notes (partner_notes). We MUST await this before
                // navigating away - navigation unmounts this component and
                // would otherwise cancel the in-flight edge-function call,
                // which is exactly why notes never reached HERO before.
                await updateHeroNotesIfLinked(projectId);
              }
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
          const vehicleParam = searchParams.get("vehicle");

          // Vehicle measured image path: route back to VehicleDetail rather
          // than LocationDetails. The annotated + original images are multi-MB,
          // so we hand them over in memory (like the Aufmaß capture flow) — NOT
          // via router state, which crashes mobile WebKit on large payloads.
          if (vehicleParam === "true") {
            if (captureActiveRef.current) {
              window.clearTimeout(draftTimerRef.current);
              await saveCaptureResult(
                { annotated: dataUrlToBlob(dataUrl), original: imageDataState ? dataUrlToBlob(imageDataState) : undefined },
                `/projects/${projectId}/vehicle`,
              );
            }
            setMeasuredResult({ annotated: dataUrl, original: imageDataState || undefined });
            navigate(`/projects/${projectId}/vehicle`);
            return;
          }

          let query = "";
          if (detailParam === "true" && locationIdParam) query = `?detail=true&locationId=${locationIdParam}`;
          else if (floorPlanParam && locationIdParam) query = `?floorPlan=${floorPlanParam}&locationId=${locationIdParam}`;
          if (captureActiveRef.current) {
            // Durable until the location is saved (LocationDetails clears it).
            window.clearTimeout(draftTimerRef.current);
            await saveCaptureResult(
              { annotated: dataUrlToBlob(dataUrl), original: imageDataState ? dataUrlToBlob(imageDataState) : undefined, areaMeasurements },
              `/projects/${projectId}/location-details${query}`,
            );
          }
          setEditorHandoff({ imageData: dataUrl, originalImageData: imageDataState, areaMeasurements });
          navigate(`/projects/${projectId}/location-details${query}`);
        }
      } catch (e: any) {
        console.error("Error exporting edited image:", e);
        toast.error("Fehler beim Verarbeiten des Bildes: " + (e?.message || String(e)));
      }
    }, 50);
  };

  // New photo: link this editor to the durable capture session. With an
  // in-memory hand-off the session only receives drafts/results; without one
  // (restart) the photo is loaded from it. Each load that never reached the
  // screen is counted – if loading the photo keeps crashing the app, retry
  // smaller and finally give up. (The "recovered" notice comes from
  // CameraInterruptNotice on app start.)
  useEffect(() => {
    if (!isFreshCapture) return;
    let cancelled = false;
    (async () => {
      const session = await getCapture();
      if (cancelled) return;
      if (!session || session.editorPath !== currentPath()) { setLoading(false); return; }
      captureActiveRef.current = true;
      if (imageDataState) { setLoading(false); return; }
      const loads = await noteEditorLoad();
      if (loads > 3) {
        await clearCapture();
        toast.error("Das Foto lässt sich auf diesem Gerät nicht öffnen. Bitte neu aufnehmen.");
        navigate(`/projects/${projectId}`, { replace: true });
        return;
      }
      try {
        const file = new File([session.photo], "foto.jpg", { type: session.photo.type || "image/jpeg" });
        // After a failed attempt, decode smaller – less memory, same workflow.
        const imageData = await readImageFileForEditor(file, loads >= 2 ? 1600 : 2200);
        if (cancelled) return;
        pendingDraftRef.current = session.draft ?? null;
        setImageDataState(imageData);
      } catch {
        toast.error("Foto konnte nicht wiederhergestellt werden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Once per editor visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle missing image data for new locations (must be useEffect, not render-time navigate)
  useEffect(() => {
    if (!loading && !imageDataState && !isReEdit) {
      toast.error("Kein Bild gefunden");
      navigate(`/projects/${projectId}`);
    }
  }, [loading, imageDataState, isReEdit, navigate, projectId]);

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-muted-foreground">Bild wird geladen...</div></div>;

  // NOTE: navigation when imageData is missing is handled in useEffect below, not here
  if (!imageDataState && !loading) {
    return null;
  }

  return (
    <div className="app-screen bg-background flex flex-col overflow-hidden">
      <div className="shrink-0 bg-card border-b p-2">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Leaving a NEW photo on purpose discards it (as before) – also
              // from the durable session, so it isn't offered again later.
              if (captureActiveRef.current) { window.clearTimeout(draftTimerRef.current); void clearCapture(); }
              navigate(`/projects/${projectId}`);
            }}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex gap-1 justify-center flex-1 flex-wrap">
            <Button variant={activeTool === "select" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("select")} className="px-2">
              <span className="text-xs">Ausw.</span>
            </Button>
            <Button variant={activeTool === "draw" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("draw")} className="px-2">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={addText} className="px-2">
              <Type className="h-4 w-4" />
            </Button>
            <Button variant={activeTool === "measure" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("measure")} className="px-2" title="Linie bemaßen">
              <Ruler className="h-4 w-4" />
            </Button>
            <Button variant={activeTool === "area" ? "default" : "outline"} size="sm" onClick={() => setActiveTool("area")} className="px-2" title="Fläche bemaßen">
              <RectangleHorizontal className="h-4 w-4" />
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
            {selectedAreaGroup && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => duplicateAreaGroup(selectedAreaGroup)}
                className="px-2"
                title="Fläche duplizieren (oder Doppelklick)"
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button onClick={handleNext} size="sm" className="shrink-0">
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={canvasAreaRef} className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center p-1">
        <canvas ref={canvasRef} />
        {/* Zoom: also pinch with two fingers (moves the picture too), mouse
            wheel on desktop; drag with space or the middle mouse button. */}
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
          <Button variant="secondary" size="icon" className="h-9 w-9 shadow-md" onClick={() => zoomBy(1.4)} title="Hineinzoomen">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" className="h-9 w-9 shadow-md" onClick={() => zoomBy(1 / 1.4)} title="Herauszoomen">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" className="h-9 w-9 shadow-md" onClick={() => fabricCanvas && fitView(fabricCanvas)} title="Ganzes Bild anzeigen">
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {measureStart && !showMeasureDialog && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground px-3 py-2 rounded-lg shadow-lg text-xs text-center z-50">
          Zweiten Punkt wählen
        </div>
      )}
      {areaStart && !showAreaDialog && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-3 py-2 rounded-lg shadow-lg text-xs text-center z-50">
          Gegenüberliegende Ecke wählen
        </div>
      )}

      <MeasurementInputDialog open={showMeasureDialog} onConfirm={handleMeasureConfirm} onCancel={handleMeasureCancel} />
      <AreaMeasurementDialog open={showAreaDialog} onConfirm={handleAreaConfirm} onCancel={handleAreaCancel} />
    </div>
  );
};

export default PhotoEditor;
