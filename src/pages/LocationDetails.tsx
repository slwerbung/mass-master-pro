import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Location, AreaMeasurement } from "@/types/project";
import { toast } from "sonner";
import { compressImage } from "@/lib/imageCompression";
import { supabase } from "@/integrations/supabase/client";
import { scheduleSyncProject } from "@/lib/supabaseSync";
import { enqueueHeroUploadIfLinked, dataUrlToBlob } from "@/lib/heroSyncHelpers";

interface FieldConfig {
  id: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  field_options: string | null;
  sort_order: number;
  is_active: boolean;
  applies_to: string;
  is_required: boolean;
}

// Compute the next running number for a new location within a project.
// Robust for mixed-mode projects (old "WER-1234-100" format + new "103"):
// extracts the trailing integer from each existing locationNumber and
// returns max + 1. Starts at 100 when the project has no locations yet.
function nextLocationNumber(existingLocations: Array<{ locationNumber?: string }>): number {
  let max = 99;
  for (const loc of existingLocations) {
    const m = loc.locationNumber?.match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

const LocationDetails = () => {
  const { projectId, locationId, detailId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEditMode = !!locationId && !detailId;
  const isDetailEditMode = !!detailId;
  const isDetailImage = searchParams.get("detail") === "true";
  const floorPlanId = searchParams.get("floorPlan");
  const presetLocationId = searchParams.get("locationId");

  const { imageData: stateImageData, originalImageData: stateOriginalImageData, areaMeasurements: stateAreaMeasurements } = location.state || {};

  // Store image data in a ref immediately so it survives re-renders and React StrictMode double-mounts
  const imageDataRef = useRef<string | null>(stateImageData || null);
  const originalImageDataRef = useRef<string | null>(stateOriginalImageData || null);
  // Sync ref if state arrives after initial render (edge case)
  if (stateImageData && !imageDataRef.current) imageDataRef.current = stateImageData;
  if (stateOriginalImageData && !originalImageDataRef.current) originalImageDataRef.current = stateOriginalImageData;

  const [caption, setCaption] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(stateImageData || null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(!isEditMode && !isDetailEditMode);

  // Dynamic fields
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [projectType, setProjectType] = useState<string | undefined>(undefined);
  const [existingAreaMeasurements, setExistingAreaMeasurements] = useState<AreaMeasurement[]>([]);

  // Load project type
  useEffect(() => {
    if (projectId) {
      indexedDBStorage.getProject(projectId).then(proj => {
        if (proj) setProjectType(proj.projectType);
      });
    }
  }, [projectId]);

  // Load field configs from Supabase
  useEffect(() => {
    supabase.from("location_field_config").select("*").eq("is_active", true).order("sort_order").then(({ data }) => {
      if (data) setFieldConfigs(data as FieldConfig[]);
    });
  }, []);

  // Filter fields by project type
  const filteredFields = fieldConfigs.filter(f => {
    if (!f.applies_to || f.applies_to === "all") return true;
    if (!projectType) return true; // show all if unknown
    return f.applies_to === projectType;
  });

  // Load existing location data in edit mode
  useEffect(() => {
    if (isEditMode && projectId && locationId) {
      const loadLocation = async () => {
        const project = await indexedDBStorage.getProject(projectId);
        if (!project) { navigate("/"); return; }
        const loc = project.locations.find(l => l.id === locationId);
        if (!loc) { navigate(`/projects/${projectId}`); return; }
        const vals: Record<string, string> = {};
        if (loc.locationName) vals["locationName"] = loc.locationName;
        setPreviewImage(loc.imageData);
        if (loc.system) vals["system"] = loc.system;
        if (loc.label) vals["label"] = loc.label;
        if (loc.locationType) vals["locationType"] = loc.locationType;
        if (loc.comment) vals["comment"] = loc.comment;
        if (loc.customFields) Object.assign(vals, loc.customFields);
        setFieldValues(vals);
        if (loc.areaMeasurements) setExistingAreaMeasurements(loc.areaMeasurements);
        setIsLoaded(true);
      };
      loadLocation();
    }
  }, [isEditMode, projectId, locationId, navigate]);

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

  const setFieldValue = (key: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  };

  const validateRequiredFields = (): boolean => {
    const missing = filteredFields.filter(f => {
      if (!f.is_required) return false;
      const val = fieldValues[f.field_key]?.trim();
      return !val || val === "";
    });
    if (missing.length > 0) {
      toast.error(`Bitte fülle alle Pflichtfelder aus: ${missing.map(f => f.field_label).join(", ")}`);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!projectId) { toast.error("Fehler beim Speichern"); return; }

    // Validate required fields for location saves (not detail images)
    if (!isDetailImage && !isDetailEditMode && !validateRequiredFields()) return;

    setIsSaving(true);
    try {
      if (isDetailEditMode && detailId) {
        await indexedDBStorage.updateDetailImageMetadata(detailId, { caption: caption.trim() || undefined });
        toast.success("Detailbild aktualisiert");
        navigate(`/projects/${projectId}`);
      } else if (isEditMode && locationId) {
        await indexedDBStorage.updateLocationMetadata(projectId, locationId, {
          locationName: fieldValues["locationName"]?.trim() || undefined,
          comment: fieldValues["comment"]?.trim() || undefined,
          system: fieldValues["system"]?.trim() || undefined,
          label: fieldValues["label"]?.trim() || undefined,
          locationType: fieldValues["locationType"]?.trim() || undefined,
          customFields: Object.fromEntries(Object.entries(fieldValues).filter(([k]) => k.startsWith("custom_"))),
        });
        scheduleSyncProject(projectId);
        toast.success("Standort aktualisiert");
        navigate(`/projects/${projectId}`);
      } else if (isDetailImage && imageDataRef.current) {
        // imageData comes from PhotoEditor already compressed (1600x0.88).
        // originalImageData is the raw camera capture and may be 4000x3000
        // or larger. Only the latter needs compression here.
        //
        // We do this SEQUENTIALLY and null the refs as soon as we've copied
        // their values out. On Android this prevents the Fabric canvas, the
        // raw base64 string, and the compression canvas from all coexisting
        // in RAM at the same time - which was causing the "nicht genügend
        // Speicherplatz" crash when users added several detail images in
        // quick succession.
        const imageDataToSave = imageDataRef.current;
        const rawOriginal = originalImageDataRef.current;
        imageDataRef.current = null;
        originalImageDataRef.current = null;

        const targetLocationId = searchParams.get("locationId");
        if (!targetLocationId) { toast.error("Standort nicht gefunden"); return; }

        toast.loading("Bild wird gespeichert...");
        const originalImageDataToSave = rawOriginal
          ? await compressImage(rawOriginal, 1600, 0.85)
          : imageDataToSave;

        const detailImage = { id: crypto.randomUUID(), imageData: imageDataToSave, originalImageData: originalImageDataToSave, caption: caption.trim() || undefined, createdAt: new Date() };
        await indexedDBStorage.saveDetailImage(targetLocationId, detailImage);

        // Mirror to HERO if project is linked. Fire-and-forget: the
        // queue write is fast (~1ms), actual upload happens in the
        // background worker without blocking this save flow.
        const projectForHero = await indexedDBStorage.getProject(projectId);
        if (projectForHero) {
          // Filename uses short location number (e.g. "100") plus a
          // per-detail sequence number, so HERO's file list stays
          // readable. "WER-1234-100" -> "100"; no dash -> whole string.
          const parentLoc = projectForHero.locations.find(l => l.id === targetLocationId);
          const locShort = parentLoc?.locationNumber?.split("-").pop() || "unbekannt";
          const detailIndex = (parentLoc?.detailImages?.length ?? 0) + 1;
          const baseName = `standort-${locShort}-detail-${detailIndex}`;
          await enqueueHeroUploadIfLinked({
            project: projectForHero,
            uploadType: "detail_image",
            blob: dataUrlToBlob(imageDataToSave),
            filename: `${baseName}.jpg`,
            locationId: targetLocationId,
            detailImageId: detailImage.id,
          });
          if (rawOriginal) {
            await enqueueHeroUploadIfLinked({
              project: projectForHero,
              uploadType: "detail_image_original",
              blob: dataUrlToBlob(originalImageDataToSave),
              filename: `${baseName}-original.jpg`,
              locationId: targetLocationId,
              detailImageId: detailImage.id,
            });
          }
        }

        toast.dismiss();
        toast.success("Detailbild gespeichert");
        navigate(`/projects/${projectId}`);
        scheduleSyncProject(projectId);
      } else if (imageDataRef.current) {
        // Same principle as the detail-image branch above: skip the
        // redundant re-compression of imageData (PhotoEditor already did
        // it) and only compress the raw original, sequentially.
        const imageDataToSave = imageDataRef.current;
        const rawOriginal = originalImageDataRef.current;
        imageDataRef.current = null;
        originalImageDataRef.current = null;

        const project = await indexedDBStorage.getProject(projectId);
        if (!project) { toast.error("Projekt nicht gefunden"); setIsSaving(false); return; }

        toast.loading("Bild wird gespeichert...");
        const originalImageDataToSave = rawOriginal
          ? await compressImage(rawOriginal, 1600, 0.85)
          : imageDataToSave;

        const locationNumber = nextLocationNumber(project.locations);
        const fullLocationNumber = String(locationNumber);
        const newLocation: Location = {
          id: presetLocationId || crypto.randomUUID(),
          locationNumber: fullLocationNumber,
          locationName: fieldValues["locationName"]?.trim() || undefined,
          comment: fieldValues["comment"]?.trim() || undefined,
          system: fieldValues["system"]?.trim() || undefined,
          label: fieldValues["label"]?.trim() || undefined,
          locationType: fieldValues["locationType"]?.trim() || undefined,
          imageData: imageDataToSave,
          originalImageData: originalImageDataToSave,
          createdAt: new Date(),
        };
        const customFields: Record<string, string> = {};
        Object.entries(fieldValues).forEach(([k, v]) => { if (k.startsWith("custom_")) customFields[k] = v; });
        if (Object.keys(customFields).length > 0) newLocation.customFields = customFields;
        // Merge new area measurements with existing ones
        const allAreaMeasurements = [...existingAreaMeasurements, ...(stateAreaMeasurements || [])];
        if (allAreaMeasurements.length > 0) {
          newLocation.areaMeasurements = allAreaMeasurements;
        }
        project.locations.push(newLocation);
        await indexedDBStorage.saveProject(project);

        // Mirror to HERO if project is linked. Uses the short location
        // number (e.g. "100") in the filename so uploads are easy to
        // identify in HERO's file list.
        const baseName = `standort-${fullLocationNumber}`;
        await enqueueHeroUploadIfLinked({
          project,
          uploadType: "location_image",
          blob: dataUrlToBlob(imageDataToSave),
          filename: `${baseName}.jpg`,
          locationId: newLocation.id,
        });
        if (rawOriginal) {
          await enqueueHeroUploadIfLinked({
            project,
            uploadType: "location_image_original",
            blob: dataUrlToBlob(originalImageDataToSave),
            filename: `${baseName}-original.jpg`,
            locationId: newLocation.id,
          });
        }

        toast.dismiss();
        toast.success("Standort gespeichert");
        if (floorPlanId) navigate(`/projects/${projectId}/floor-plans`);
        else navigate(`/projects/${projectId}`);
        scheduleSyncProject(projectId);
      }
    } catch (error) {
      toast.dismiss();
      console.error("Error saving:", error);
      // Recognize browser-storage-quota errors explicitly so the user
      // doesn't just see a generic "Fehler beim Speichern" and wonder why.
      // Both direct DOMException and wrapped errors that mention quota
      // should trigger the friendly message.
      const msg = String((error as any)?.message || error || "").toLowerCase();
      const isQuotaError =
        (error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22)) ||
        msg.includes("quota") ||
        msg.includes("not enough space") ||
        msg.includes("nicht genug");
      if (isQuotaError) {
        toast.error(
          "Speicher voll: nicht genug Platz im Browser. Bitte alte Projekte archivieren oder Browser-Cache leeren, dann erneut versuchen.",
          { duration: 10000 }
        );
      } else {
        toast.error("Fehler beim Speichern");
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!isLoaded || (!isEditMode && !isDetailEditMode && !stateImageData)) return null;

  const title = isDetailEditMode ? "Detailbild bearbeiten" : isEditMode ? "Standort bearbeiten" : isDetailImage ? "Detailbild-Details" : "Standort-Details";

  const renderField = (field: FieldConfig) => {
    const value = fieldValues[field.field_key] || "";
    const requiredMark = field.is_required ? " *" : " (optional)";
    switch (field.field_type) {
      case "text":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.field_key}>{field.field_label}{requiredMark}</Label>
            <Input id={field.field_key} placeholder={field.field_label} value={value} onChange={(e) => setFieldValue(field.field_key, e.target.value)} />
          </div>
        );
      case "textarea":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.field_key}>{field.field_label}{requiredMark}</Label>
            <Textarea id={field.field_key} placeholder={field.field_label} value={value} onChange={(e) => setFieldValue(field.field_key, e.target.value)} rows={3} />
          </div>
        );
      case "dropdown": {
        const options: string[] = field.field_options ? JSON.parse(field.field_options) : [];
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.field_key}>{field.field_label}{requiredMark}</Label>
            <Select value={value} onValueChange={(v) => setFieldValue(field.field_key, v)}>
              <SelectTrigger id={field.field_key}><SelectValue placeholder={`${field.field_label} auswählen...`} /></SelectTrigger>
              <SelectContent>{options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        );
      }
      case "checkbox":
        return (
          <div key={field.id} className="flex items-center gap-3 py-1">
            <Checkbox id={field.field_key} checked={value === "true"} onCheckedChange={(checked) => setFieldValue(field.field_key, checked ? "true" : "false")} />
            <Label htmlFor={field.field_key} className="cursor-pointer">{field.field_label}{field.is_required ? " *" : ""}</Label>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)} size="sm"><ArrowLeft className="mr-1 md:mr-2 h-4 w-4" /><span className="text-sm md:text-base">Zurück</span></Button>
        <Card>
          <CardHeader className="p-4 md:p-6"><CardTitle className="text-xl md:text-2xl">{title}</CardTitle></CardHeader>
          <CardContent className="space-y-4 md:space-y-6 p-4 md:p-6">
            {previewImage && (
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                <img src={previewImage} alt="Bild" className="w-full h-full object-contain" />
              </div>
            )}
            {/* Area Measurements Summary */}
            {(() => {
              const allMeasurements = [...existingAreaMeasurements, ...(stateAreaMeasurements || [])];
              if (allMeasurements.length === 0) return null;
              const totalM2 = allMeasurements.reduce((sum, m) => sum + (m.widthMm * m.heightMm) / 1_000_000, 0);
              return (
                <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                  <p className="font-medium text-foreground">Flächenaufmaß</p>
                  {allMeasurements.map((m) => {
                    const m2 = (m.widthMm * m.heightMm) / 1_000_000;
                    return (
                      <p key={m.index} className="text-muted-foreground">
                        F {m.index}: {m.widthMm} × {m.heightMm} mm ({m2.toFixed(2)} m²)
                      </p>
                    );
                  })}
                  <p className="font-semibold text-foreground border-t border-border pt-1 mt-1">
                    Gesamt: {totalM2.toFixed(2)} m²
                  </p>
                </div>
              );
            })()}
            <div className="space-y-4">
              {isDetailImage || isDetailEditMode ? (
                <div className="space-y-2">
                  <Label htmlFor="caption">Beschreibung (optional)</Label>
                  <Input id="caption" placeholder="z.B. Detail Fensterrahmen" value={caption} onChange={(e) => setCaption(e.target.value)} />
                </div>
              ) : (
                <>
                  {filteredFields.map(renderField)}
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
