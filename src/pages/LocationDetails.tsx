import { useState, useEffect, useCallback } from "react";
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
import { Location } from "@/types/project";
import { toast } from "sonner";
import { compressImage } from "@/lib/imageCompression";
import { supabase } from "@/integrations/supabase/client";
import { syncProjectToSupabase } from "@/lib/supabaseSync";

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
        const syncResult = await syncProjectToSupabase(projectId);
        if (syncResult === "remote-won") toast.warning("Neuere Online-Version übernommen");
        else toast.success("Standort aktualisiert");
        navigate(`/projects/${projectId}`);
      } else if (isDetailImage && stateImageData) {
        toast.loading("Bild wird komprimiert...");
        const compressedImageData = await compressImage(stateImageData, 1280, 0.65);
        const compressedOriginalImageData = stateOriginalImageData ? await compressImage(stateOriginalImageData, 1280, 0.65) : compressedImageData;
        const targetLocationId = searchParams.get("locationId");
        if (!targetLocationId) { toast.error("Standort nicht gefunden"); return; }
        const detailImage = { id: crypto.randomUUID(), imageData: compressedImageData, originalImageData: compressedOriginalImageData, caption: caption.trim() || undefined, createdAt: new Date() };
        await indexedDBStorage.saveDetailImage(targetLocationId, detailImage);
        const syncResult = await syncProjectToSupabase(projectId);
        toast.dismiss();
        if (syncResult === "remote-won") toast.warning("Neuere Online-Version übernommen");
        else toast.success("Detailbild gespeichert");
        navigate(`/projects/${projectId}`);
      } else if (stateImageData) {
        const project = await indexedDBStorage.getProject(projectId);
        if (!project) { toast.error("Projekt nicht gefunden"); setIsSaving(false); return; }
        toast.loading("Bild wird komprimiert...");
        const compressedImageData = await compressImage(stateImageData, 1280, 0.65);
        const compressedOriginalImageData = stateOriginalImageData ? await compressImage(stateOriginalImageData, 1280, 0.65) : compressedImageData;
        const locationNumber = project.locations.length + 1;
        const fullLocationNumber = `${project.projectNumber}-${100 + locationNumber - 1}`;
        const newLocation: Location = {
          id: presetLocationId || crypto.randomUUID(),
          locationNumber: fullLocationNumber,
          locationName: fieldValues["locationName"]?.trim() || undefined,
          comment: fieldValues["comment"]?.trim() || undefined,
          system: fieldValues["system"]?.trim() || undefined,
          label: fieldValues["label"]?.trim() || undefined,
          locationType: fieldValues["locationType"]?.trim() || undefined,
          imageData: compressedImageData,
          originalImageData: compressedOriginalImageData,
          createdAt: new Date(),
        };
        const customFields: Record<string, string> = {};
        Object.entries(fieldValues).forEach(([k, v]) => { if (k.startsWith("custom_")) customFields[k] = v; });
        if (Object.keys(customFields).length > 0) newLocation.customFields = customFields;
        if (stateAreaMeasurements && stateAreaMeasurements.length > 0) {
          newLocation.areaMeasurements = stateAreaMeasurements;
        }
        project.locations.push(newLocation);
        await indexedDBStorage.saveProject(project);
        const syncResult = await syncProjectToSupabase(projectId);
        toast.dismiss();
        if (syncResult === "remote-won") toast.warning("Neuere Online-Version übernommen");
        else toast.success("Standort gespeichert");
        if (floorPlanId) navigate(`/projects/${projectId}/floor-plans`);
        else navigate(`/projects/${projectId}`);
      }
    } catch (error) {
      toast.dismiss();
      console.error("Error saving:", error);
      toast.error("Fehler beim Speichern");
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
