import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Upload, Trash2, FileText, Download, ImagePlus, Car, Check, X, Pencil, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { deleteProjectFromSupabase } from "@/lib/supabaseSync";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { enqueueHeroUploadIfLinked, dataUrlToBlob } from "@/lib/heroSyncHelpers";

interface VehicleFieldConfig {
  id: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  field_options: string | null;
  is_active: boolean;
  is_required: boolean;
  sort_order: number;
}

interface VehicleImage {
  id: string;
  project_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

// Bemaßte Bilder - images-with-drawings. Stored in a separate table
// so they stay employee-only (hidden from customer approval view) and
// don't get mixed with the regular vehicle_images gallery.
interface VehicleMeasuredImage {
  id: string;
  project_id: string;
  storage_path: string;
  original_storage_path: string | null;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

interface VehicleLayout {
  id: string;
  project_id: string;
  storage_path: string;
  file_name: string;
  uploaded_at: string;
}

interface FeedbackItem {
  id: string;
  project_id: string;
  message: string;
  author_name: string;
  author_customer_id: string | null;
  status: "open" | "done";
  created_at: string;
}

const VehicleDetail = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const session = getSession();
  // Only employees see the "Bilder bemaßt" section. Customers accessing
  // the page via guest link won't have a session, and even if they do,
  // the role check below keeps the section hidden.
  const isEmployee = session && (session.role === "admin" || session.role === "employee");

  const [project, setProject] = useState<any>(null);
  const [fieldConfigs, setFieldConfigs] = useState<VehicleFieldConfig[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [editingFields, setEditingFields] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [measuredImages, setMeasuredImages] = useState<VehicleMeasuredImage[]>([]);
  const [layout, setLayout] = useState<VehicleLayout | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMeasured, setUploadingMeasured] = useState(false);
  const [uploadingLayout, setUploadingLayout] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const layoutInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // When PhotoEditor navigates back with measured-image data in location.state,
  // upload both variants (bemaßt + original) to Supabase Storage and insert a
  // row into vehicle_measured_images. Also mirror both to HERO. This runs only
  // once per navigation via a state check; clearing history.state prevents
  // re-upload on tab focus/remount.
  useEffect(() => {
    const state = location.state as { measuredImageData?: string; measuredOriginalImageData?: string } | null;
    if (!state?.measuredImageData || !projectId) return;

    const upload = async () => {
      setUploadingMeasured(true);
      try {
        const uuid = crypto.randomUUID();
        const bemasstPath = `vehicle-measured-images/${projectId}/${uuid}-bemasst.jpg`;
        const bemasstBlob = dataUrlToBlob(state.measuredImageData!);
        const { error: upErr1 } = await supabase.storage
          .from("project-files")
          .upload(bemasstPath, bemasstBlob, { contentType: "image/jpeg" });
        if (upErr1) throw upErr1;

        let originalPath: string | null = null;
        let originalBlob: Blob | null = null;
        if (state.measuredOriginalImageData && state.measuredOriginalImageData !== state.measuredImageData) {
          originalPath = `vehicle-measured-images/${projectId}/${uuid}-original.jpg`;
          originalBlob = dataUrlToBlob(state.measuredOriginalImageData);
          const { error: upErr2 } = await supabase.storage
            .from("project-files")
            .upload(originalPath, originalBlob, { contentType: "image/jpeg" });
          if (upErr2) throw upErr2;
        }

        const { error: dbErr } = await supabase.from("vehicle_measured_images").insert({
          project_id: projectId,
          storage_path: bemasstPath,
          original_storage_path: originalPath,
          uploaded_by: session?.name || "Mitarbeiter",
        });
        if (dbErr) throw dbErr;

        // Mirror to HERO - two separate queue items so we get both the
        // bemaßt version (primary reference) and the untouched original
        // (for context) into HERO's gallery.
        // We re-fetch the project here rather than relying on the
        // `project` state because both useEffects (loadAll, this upload)
        // race - the upload effect can finish before loadAll completes,
        // leaving project still null and silently skipping the HERO sync.
        const { data: projForHero } = await supabase
          .from("projects")
          .select("id, custom_fields")
          .eq("id", projectId)
          .maybeSingle();
        if (projForHero) {
          const projShim = {
            id: projForHero.id,
            customFields: projForHero.custom_fields as any,
          };
          await enqueueHeroUploadIfLinked({
            project: projShim,
            uploadType: "vehicle_measured_image",
            blob: bemasstBlob,
            filename: `bemasst-${uuid.slice(0, 8)}.jpg`,
          });
          if (originalBlob) {
            await enqueueHeroUploadIfLinked({
              project: projShim,
              uploadType: "vehicle_measured_image_original",
              blob: originalBlob,
              filename: `bemasst-${uuid.slice(0, 8)}-original.jpg`,
            });
          }
        }

        toast.success("Bemaßtes Bild gespeichert");
        // Strip state so this effect doesn't re-fire on focus/remount.
        window.history.replaceState({}, "");
        await loadAll();
      } catch (e: any) {
        toast.error("Fehler beim Speichern: " + (e.message || String(e)));
      } finally {
        setUploadingMeasured(false);
      }
    };
    upload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, projectId]);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [
        { data: proj },
        { data: configs },
        { data: values },
        { data: imgs },
        { data: measured },
        { data: layouts },
        { data: fbs },
      ] = await Promise.all([
        supabase.from("projects").select("id, project_number, customer_name, custom_fields, project_type").eq("id", projectId!).maybeSingle(),
        supabase.from("vehicle_field_config").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("vehicle_field_values").select("field_key, value").eq("project_id", projectId!),
        supabase.from("vehicle_images").select("*").eq("project_id", projectId!).order("created_at"),
        // Measured (bemaßt) images are employee-only in the UI, but the
        // query itself isn't gated - the render logic hides the section
        // if !isEmployee. Fetching them anyway is cheap and keeps the
        // code path identical regardless of who's viewing.
        supabase.from("vehicle_measured_images").select("*").eq("project_id", projectId!).order("created_at"),
        supabase.from("vehicle_layouts").select("*").eq("project_id", projectId!).order("uploaded_at", { ascending: false }).limit(1),
        supabase.from("vehicle_layout_feedback").select("*").eq("project_id", projectId!).order("created_at"),
      ]);

      setProject(proj);
      setFieldConfigs((configs || []) as VehicleFieldConfig[]);
      const vals: Record<string, string> = {};
      (values || []).forEach((v: any) => { vals[v.field_key] = v.value || ""; });
      setFieldValues(vals);
      setImages((imgs || []) as VehicleImage[]);
      setMeasuredImages((measured || []) as VehicleMeasuredImage[]);
      setLayout(layouts && layouts.length > 0 ? (layouts[0] as VehicleLayout) : null);
      setFeedbacks((fbs || []) as FeedbackItem[]);
    } catch (e) {
      toast.error("Fehler beim Laden");
    } finally {
      setIsLoading(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) { toast.error("Bitte Bilddateien auswählen"); return; }
    setUploadingImage(true);
    let uploaded = 0;
    let lastError = "";
    for (const file of imageFiles) {
      try {
        const path = `vehicle-images/${projectId}/${crypto.randomUUID()}`;
        const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, { contentType: file.type });
        if (uploadError) {
          // 409 = already exists (shouldn't happen with UUID path, but handle anyway)
          if ((uploadError as any).statusCode === '409' || uploadError.message?.includes('already exists')) {
            const { error: updateError } = await supabase.storage.from("project-files").update(path, file, { contentType: file.type });
            if (updateError) { lastError = updateError.message; continue; }
          } else {
            lastError = uploadError.message;
            continue;
          }
        }
        const { error: dbError } = await supabase.from("vehicle_images").insert({
          project_id: projectId,
          storage_path: path,
          uploaded_by: session?.name || "Mitarbeiter",
        });
        if (dbError) { lastError = dbError.message; continue; }
        uploaded++;

        // Mirror to HERO. The project row we loaded uses snake_case,
        // so adapt it to the camelCase shape enqueueHeroUploadIfLinked
        // expects. Skipped silently if project isn't linked to HERO.
        if (project) {
          await enqueueHeroUploadIfLinked({
            project: {
              id: project.id,
              customFields: project.custom_fields || project.customFields,
            },
            uploadType: "vehicle_image",
            blob: file,
            filename: `fahrzeug-${file.name}`,
          });
        }
      } catch (e: any) { lastError = e?.message || "Unbekannter Fehler"; }
    }
    setUploadingImage(false);
    if (uploaded > 0) {
      toast.success(`${uploaded} Bild${uploaded > 1 ? "er" : ""} hochgeladen`);
      loadAll();
    } else {
      toast.error("Upload fehlgeschlagen: " + lastError);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !projectId) return;
    await uploadFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) await uploadFiles(e.dataTransfer.files);
  };

  const handleLayoutUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    setUploadingLayout(true);
    try {
      // Remove old layout from storage if exists
      if (layout) {
        await supabase.storage.from("project-files").remove([layout.storage_path]);
        await supabase.from("vehicle_layouts").delete().eq("id", layout.id);
      }
      const path = `vehicle-layouts/${projectId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, { contentType: file.type });
      if (uploadError) {
        if ((uploadError as any).statusCode === '409' || uploadError.message?.includes('already exists')) {
          const { error: updateError } = await supabase.storage.from("project-files").update(path, file, { contentType: file.type });
          if (updateError) throw updateError;
        } else {
          throw uploadError;
        }
      }
      const { error: dbError } = await supabase.from("vehicle_layouts").insert({
        project_id: projectId,
        storage_path: path,
        file_name: file.name,
      });
      if (dbError) throw dbError;

      // Mirror to HERO - treated as a document so it appears in HERO's
      // documents section, not the photo gallery.
      if (project) {
        await enqueueHeroUploadIfLinked({
          project: {
            id: project.id,
            customFields: project.custom_fields || project.customFields,
          },
          uploadType: "vehicle_layout",
          blob: file,
          filename: `layout-${file.name}`,
        });
      }

      toast.success("Layout hochgeladen");
      loadAll();
    } catch (err: any) {
      toast.error("Upload fehlgeschlagen: " + err.message);
    } finally {
      setUploadingLayout(false);
      e.target.value = "";
    }
  };

  const deleteImage = async (img: VehicleImage) => {
    try {
      await supabase.storage.from("project-files").remove([img.storage_path]);
      await supabase.from("vehicle_images").delete().eq("id", img.id);
      setImages(prev => prev.filter(i => i.id !== img.id));
      toast.success("Bild gelöscht");
    } catch {
      toast.error("Fehler beim Löschen");
    }
  };

  const deleteLayout = async () => {
    if (!layout) return;
    try {
      await supabase.storage.from("project-files").remove([layout.storage_path]);
      await supabase.from("vehicle_layouts").delete().eq("id", layout.id);
      setLayout(null);
      toast.success("Layout gelöscht");
    } catch {
      toast.error("Fehler beim Löschen");
    }
  };

  const saveCaption = async (img: VehicleImage) => {
    await supabase.from("vehicle_images").update({ caption: captionDraft.trim() || null }).eq("id", img.id);
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, caption: captionDraft.trim() || null } : i));
    setEditingCaptionId(null);
  };

  const startEditFields = () => {
    setDraftValues({ ...fieldValues });
    setEditingFields(true);
  };

  const saveFields = async () => {
    setSavingFields(true);
    try {
      for (const config of fieldConfigs) {
        const value = draftValues[config.field_key] || "";
        await supabase.from("vehicle_field_values").upsert(
          { project_id: projectId!, field_key: config.field_key, value, updated_at: new Date().toISOString() },
          { onConflict: "project_id,field_key" }
        );
      }
      setFieldValues({ ...draftValues });
      setEditingFields(false);
      toast.success("Informationen gespeichert");
    } catch {
      toast.error("Fehler beim Speichern");
    } finally {
      setSavingFields(false);
    }
  };

  const toggleFeedbackStatus = async (fb: FeedbackItem) => {
    const newStatus = fb.status === "open" ? "done" : "open";
    await supabase.from("vehicle_layout_feedback").update({
      status: newStatus,
      resolved_at: newStatus === "done" ? new Date().toISOString() : null,
    }).eq("id", fb.id);
    setFeedbacks(prev => prev.map(f => f.id === fb.id ? { ...f, status: newStatus } : f));
  };

  const deleteFeedback = async (id: string) => {
    await supabase.from("vehicle_layout_feedback").delete().eq("id", id);
    setFeedbacks(prev => prev.filter(f => f.id !== id));
    toast.success("Rückmeldung gelöscht");
  };

  const handleDeleteProject = async () => {
    try {
      // Clean up vehicle-specific data
      if (images.length > 0) {
        await supabase.storage.from("project-files").remove(images.map(i => i.storage_path));
      }
      if (layout) {
        await supabase.storage.from("project-files").remove([layout.storage_path]);
      }
      await deleteProjectFromSupabase(projectId!);
      await indexedDBStorage.deleteProject(projectId!);
      toast.success("Projekt gelöscht");
      navigate("/projects");
    } catch {
      toast.error("Fehler beim Löschen");
    }
  };

  const getPublicUrl = (path: string) => {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    return data.publicUrl;
  };

  const renderFieldValue = (config: VehicleFieldConfig, value: string, onChange: (v: string) => void) => {
    let options: string[] = [];
    try { options = config.field_options ? JSON.parse(config.field_options) : []; } catch {}
    if (config.field_type === "textarea") return <Textarea value={value} onChange={e => onChange(e.target.value)} rows={3} />;
    if (config.field_type === "dropdown") return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
    if (config.field_type === "checkbox") return (
      <div className="flex items-center gap-2 h-10">
        <Checkbox checked={value === "true"} onCheckedChange={c => onChange(c ? "true" : "false")} />
        <span className="text-sm text-muted-foreground">Ja / Nein</span>
      </div>
    );
    return <Input value={value} onChange={e => onChange(e.target.value)} />;
  };

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Laden...</p></div>;
  if (!project) return null;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container max-w-3xl mx-auto p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <div className="flex items-center gap-2">
                <Car className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-bold">{project.project_number}</h1>
              </div>
              <p className="text-sm text-muted-foreground">Fahrzeugbeschriftung</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/guest/${projectId}`); toast.success("Gast-Link kopiert!"); }}>
              <Share2 className="h-4 w-4 mr-1" /><span className="hidden sm:inline text-xs">Gast-Link</span>
            </Button>
            <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Projekt löschen?</AlertDialogTitle>
                <AlertDialogDescription>Alle Bilder, das Layout und alle Daten werden unwiderruflich gelöscht.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </div>
        </div>

        {/* Vehicle Images */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Fahrzeugbilder</CardTitle>
              <Button size="sm" variant="outline" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}>
                <ImagePlus className="h-4 w-4 mr-1" />
                {uploadingImage ? "Lädt..." : "Bild hinzufügen"}
              </Button>
              <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {images.length === 0 ? (
              <label
                htmlFor="vehicle-image-drop"
                className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input id="vehicle-image-drop" ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                <ImagePlus className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">Bilder hierher ziehen</p>
                  <p className="text-xs text-muted-foreground mt-1">oder tippen zum Auswählen — mehrere Bilder möglich</p>
                </div>
                {uploadingImage && <p className="text-sm text-primary">Lädt hoch...</p>}
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {images.map(img => (
                  <div key={img.id} className="relative group rounded-lg overflow-hidden border bg-muted">
                    <img src={getPublicUrl(img.storage_path)} alt={img.caption || "Fahrzeugbild"} className="w-full h-40 object-cover" />
                    <div className="p-2 space-y-1">
                      {editingCaptionId === img.id ? (
                        <div className="flex gap-1">
                          <Input value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} placeholder="Beschriftung..." className="h-7 text-xs" autoFocus />
                          <Button size="sm" className="h-7 px-2" onClick={() => saveCaption(img)}><Check className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingCaptionId(null)}><X className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-1">
                          <button className="text-xs text-muted-foreground hover:text-foreground text-left flex-1 truncate" onClick={() => { setEditingCaptionId(img.id); setCaptionDraft(img.caption || ""); }}>
                            {img.caption || <span className="italic">Beschriftung hinzufügen</span>}
                          </button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive opacity-60 hover:opacity-100" onClick={() => deleteImage(img)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bemaßte Bilder — employee-only section. Opens the camera flow
            with ?vehicle=true, which routes back here after editing with
            both the edited and original image variants. Customers and
            guest-link users don't see this at all. */}
        {isEmployee && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Bilder bemaßt</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/projects/${projectId}/camera?vehicle=true`)}
                  disabled={uploadingMeasured}
                >
                  <ImagePlus className="h-4 w-4 mr-1" />
                  {uploadingMeasured ? "Lädt..." : "Bild aufnehmen"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {measuredImages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Noch keine bemaßten Bilder. Über die Kamera aufnehmen und im Editor bemaßen.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {measuredImages.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => navigate(`/projects/${projectId}/vehicle/measured/${m.id}/edit-image`)}
                      className="relative rounded-lg overflow-hidden border bg-muted hover:ring-2 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-primary text-left"
                      title="Zum Weiterbearbeiten antippen"
                    >
                      <img
                        src={getPublicUrl(m.storage_path)}
                        alt="Bemaßtes Bild"
                        className="w-full h-40 object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Vehicle Information */}
        {fieldConfigs.length > 0 && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Fahrzeuginformationen</CardTitle>
                {!editingFields ? (
                  <Button size="sm" variant="outline" onClick={startEditFields}><Pencil className="h-3 w-3 mr-1" /> Bearbeiten</Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingFields(false)}>Abbrechen</Button>
                    <Button size="sm" onClick={saveFields} disabled={savingFields}>{savingFields ? "Speichert..." : "Speichern"}</Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {fieldConfigs.map(config => (
                <div key={config.field_key} className="space-y-1">
                  <Label className="text-sm">{config.field_label}{config.is_required ? " *" : ""}</Label>
                  {editingFields ? (
                    renderFieldValue(config, draftValues[config.field_key] || "", v => setDraftValues(prev => ({ ...prev, [config.field_key]: v })))
                  ) : (
                    <p className="text-sm text-muted-foreground min-h-[1.5rem]">
                      {fieldValues[config.field_key]
                        ? config.field_type === "checkbox"
                          ? fieldValues[config.field_key] === "true" ? "Ja" : "Nein"
                          : fieldValues[config.field_key]
                        : <span className="italic">–</span>
                      }
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Layout */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Layout / Produktionsdatei</CardTitle>
              <Button size="sm" variant="outline" onClick={() => layoutInputRef.current?.click()} disabled={uploadingLayout}>
                <Upload className="h-4 w-4 mr-1" />
                {uploadingLayout ? "Lädt..." : layout ? "Ersetzen" : "Hochladen"}
              </Button>
              <input ref={layoutInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.svg,.ai,.eps" className="hidden" onChange={handleLayoutUpload} />
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {!layout ? (
              <p className="text-sm text-muted-foreground text-center py-4">Noch kein Layout hochgeladen.</p>
            ) : (
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/20">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate">{layout.file_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDateTimeSafe(layout.uploaded_at)}</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={async () => { window.open(getPublicUrl(layout.storage_path), "_blank"); }}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteLayout}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Feedback (read-only for employees, but they can mark as done) */}
        {feedbacks.length > 0 && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">Kundenfeedback zum Layout</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {feedbacks.map(fb => (
                <div key={fb.id} className="rounded-lg border p-3 bg-muted/20 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{fb.author_name}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTimeSafe(fb.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleFeedbackStatus(fb)}
                        className={`text-xs px-2 py-0.5 rounded cursor-pointer ${fb.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
                      >
                        {fb.status === "done" ? "Umgesetzt" : "Offen"}
                      </button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteFeedback(fb.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{fb.message}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default VehicleDetail;
