import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Upload, Trash2, FileText, Download, ImagePlus, Car, Check, X, Pencil, Share2, CheckCheck, AlertTriangle, Clock, Mail, Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { deleteProjectFromSupabase } from "@/lib/supabaseSync";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { MeetingNotesCard } from "@/components/MeetingNotesCard";
import { enqueueHeroUploadIfLinked, getHeroProjectMatchId } from "@/lib/heroSyncHelpers";
import { LocationApprovalMedia } from "@/components/LocationApprovalMedia";
import { InviteCustomerDialog } from "@/components/InviteCustomerDialog";
import LocationChat, { ChatMessage } from "@/components/LocationChat";

// Which layout files can be previewed inline (PDF via pdf.js, images via <img>).
// .ai/.eps and similar stay as a download link only.
function layoutPreviewKind(name: string): "pdf" | "image" | null {
  const n = (name || "").toLowerCase();
  if (/\.pdf$/.test(n)) return "pdf";
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(n)) return "image";
  return null;
}

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
  author_type?: string;
  status: "open" | "done";
  created_at: string;
}

const VehicleDetail = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const session = getSession();

  const [project, setProject] = useState<any>(null);
  const [fieldConfigs, setFieldConfigs] = useState<VehicleFieldConfig[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [editingFields, setEditingFields] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [layout, setLayout] = useState<VehicleLayout | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [vehicleApproved, setVehicleApproved] = useState(false);
  const [measuredImages, setMeasuredImages] = useState<any[]>([]);
  const [uploadingMeasured, setUploadingMeasured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingLayout, setUploadingLayout] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [busyFeedbackId, setBusyFeedbackId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCameraRef = useRef<HTMLInputElement>(null);
  const layoutInputRef = useRef<HTMLInputElement>(null);
  const measuredInputRef = useRef<HTMLInputElement>(null);
  const measuredCameraRef = useRef<HTMLInputElement>(null);
  // Touch devices get a dedicated camera button (capture input); on desktop it
  // is hidden since "capture" just opens the file dialog there anyway.
  const isMobile = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

  useEffect(() => {
    if (!projectId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [
        { data: proj },
        { data: configs },
        { data: values },
        { data: imgs },
        { data: layouts },
        { data: fbs },
        { data: measured },
        { data: approvals },
      ] = await Promise.all([
        supabase.from("projects").select("id, project_number, customer_name, custom_fields, project_type").eq("id", projectId!).maybeSingle(),
        supabase.from("vehicle_field_config").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("vehicle_field_values").select("field_key, value").eq("project_id", projectId!),
        supabase.from("vehicle_images").select("*").eq("project_id", projectId!).order("created_at"),
        supabase.from("vehicle_layouts").select("*").eq("project_id", projectId!).order("uploaded_at", { ascending: false }).limit(1),
        supabase.from("vehicle_layout_feedback").select("*").eq("project_id", projectId!).order("created_at"),
        supabase.from("vehicle_measured_images").select("*").eq("project_id", projectId!).order("created_at"),
        supabase.from("vehicle_layout_approval").select("approved").eq("project_id", projectId!).eq("approved", true),
      ]);

      setProject(proj);
      setVehicleApproved(((approvals as any[]) || []).length > 0);
      setFieldConfigs((configs || []) as VehicleFieldConfig[]);
      const vals: Record<string, string> = {};
      (values || []).forEach((v: any) => { vals[v.field_key] = v.value || ""; });
      setFieldValues(vals);
      setImages((imgs || []) as VehicleImage[]);
      setLayout(layouts && layouts.length > 0 ? (layouts[0] as VehicleLayout) : null);
      setFeedbacks((fbs || []) as FeedbackItem[]);
      setMeasuredImages(measured || []);
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

  const handleMeasuredUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMeasured(true);
    try {
      const id = crypto.randomUUID();
      const path = `vehicle-measured/${projectId}/${id}`;
      const { error: upErr } = await supabase.storage.from("project-files").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("vehicle_measured_images").insert({
        id, project_id: projectId, storage_path: path,
        uploaded_by: session?.name || "Mitarbeiter",
      });
      if (dbErr) throw dbErr;

      // Always mirror EVERY measured image to HERO — regardless of whether it
      // is annotated later. (Previously only the annotated version reached HERO
      // via the editor, so un-annotated ones were never uploaded.)
      const projectLike = { id: projectId!, customFields: project?.custom_fields as Record<string, string> | undefined };
      try {
        await enqueueHeroUploadIfLinked({
          project: projectLike,
          uploadType: "vehicle_measured_image",
          blob: file,
          filename: `fahrzeug-bemasst-${id.slice(0, 8)}-${file.name}`,
        });
      } catch (mirrorErr) {
        console.warn("HERO mirror of measured image failed:", mirrorErr);
      }

      // Fire the "measured vehicle image uploaded" automation (e.g. HERO status
      // change). Server-side dispatch; best-effort.
      try {
        const heroProjectId = getHeroProjectMatchId(projectLike);
        await supabase.functions.invoke("run-automations", {
          body: { trigger_type: "vehicle_measured_uploaded", context: { projectId, heroProjectId } },
        });
      } catch (autoErr) {
        console.warn("vehicle_measured_uploaded automation dispatch failed:", autoErr);
      }

      toast.success("Bild hochgeladen");
      loadAll();
    } catch (err: any) {
      toast.error("Upload fehlgeschlagen: " + err.message);
    } finally {
      setUploadingMeasured(false);
      if (measuredInputRef.current) measuredInputRef.current.value = "";
    }
  };

  const deleteMeasuredImage = async (img: any) => {
    try {
      if (img.storage_path) await supabase.storage.from("project-files").remove([img.storage_path]);
      if (img.original_storage_path) await supabase.storage.from("project-files").remove([img.original_storage_path]);
      await supabase.from("vehicle_measured_images").delete().eq("id", img.id);
      setMeasuredImages(prev => prev.filter(m => m.id !== img.id));
      toast.success("Bild gelöscht");
    } catch (err: any) {
      toast.error("Fehler beim Löschen: " + err.message);
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

  // Employee reply in the layout correction thread (same flow as Aufmaß).
  const sendEmployeeMessage = async (text: string) => {
    const message = text.trim();
    if (!message || !projectId) return;
    setSendingMsg(true);
    try {
      const { data, error } = await supabase.from("vehicle_layout_feedback").insert({
        project_id: projectId,
        message,
        author_name: session?.name || "Mitarbeiter",
        author_customer_id: null,
        author_type: "employee",
        status: "open",
      }).select().single();
      if (error) throw error;
      setFeedbacks(prev => [...prev, data as FeedbackItem]);
    } catch (e: any) {
      toast.error("Nachricht konnte nicht gesendet werden: " + (e?.message || "Fehler"));
    } finally {
      setSendingMsg(false);
    }
  };

  // Maps a stored feedback row to the LocationChat shape. author_type may be
  // missing on very old rows; fall back to customer for anything not marked
  // as an employee reply.
  const chatMessages: ChatMessage[] = feedbacks.map((f) => ({
    id: f.id,
    author_name: f.author_name,
    author_type: f.author_type === "employee" ? "employee" : "customer",
    message: f.message,
    status: f.status,
    created_at: f.created_at,
    author_customer_id: f.author_customer_id,
  }));

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

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Laden…</p></div>;
  if (!project) return null;

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5">
        <div className="container max-w-3xl mx-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <Car className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold truncate">{project.project_number}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">Fahrzeugbeschriftung</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost" size="icon" className="h-9 w-9"
              onClick={() => setInviteOpen(true)}
              title="Kunde per Mail einladen"
            >
              <Mail className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-9 w-9"
              onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/guest/${projectId}`); toast.success("Gast-Link kopiert!"); }}
              title="Gast-Link kopieren"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10">
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
      </div>

      <div className="container max-w-3xl mx-auto p-4 md:p-6 space-y-4 pb-10">
        {/* Project title + Freigabestatus (wie bei den anderen Projektarten) */}
        <div className="pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{project.project_number}</h1>
            {vehicleApproved ? (
              <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium">
                <CheckCheck className="h-4 w-4" /> Komplett freigegeben
              </span>
            ) : feedbacks.some((f) => f.status === "open") ? (
              <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                <AlertTriangle className="h-4 w-4" /> Korrekturen
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                <Clock className="h-4 w-4" /> Offen
              </span>
            )}
          </div>
          {project.customer_name && <p className="text-sm text-muted-foreground mt-0.5">{project.customer_name}</p>}
        </div>

        {/* Layout / Produktionsdatei — oben und sichtbar (wie das Aufmaß-Bild) */}
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
          <CardContent className="p-4 space-y-3">
            {!layout ? (
              <p className="text-sm text-muted-foreground text-center py-4">Noch kein Layout hochgeladen.</p>
            ) : (
              <>
                {(() => {
                  const kind = layoutPreviewKind(layout.file_name);
                  const url = getPublicUrl(layout.storage_path);
                  const thumb = images[0] ? getPublicUrl(images[0].storage_path) : undefined;
                  if (kind === "pdf") return <LocationApprovalMedia pdfs={[{ url, name: layout.file_name }]} annotatedUrl={thumb} />;
                  if (kind === "image") return <LocationApprovalMedia pdfs={[]} annotatedUrl={url} />;
                  return null;
                })()}
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">{layout.file_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDateTimeSafe(layout.uploaded_at)}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => window.open(getPublicUrl(layout.storage_path), "_blank")}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteLayout}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Gesprächsnotizen (Diktiergerät → Transkript → Protokoll → HERO) */}
        <MeetingNotesCard projectId={projectId!} projectNumber={project.project_number} />

        {/* Vehicle Images */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Fahrzeugbilder</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}>
                  <ImagePlus className="h-4 w-4 mr-1" />
                  {uploadingImage ? "Lädt..." : "Hochladen"}
                </Button>
                {isMobile && (
                  <Button size="sm" variant="outline" onClick={() => imageCameraRef.current?.click()} disabled={uploadingImage}>
                    <Camera className="h-4 w-4 mr-1" /> Kamera
                  </Button>
                )}
              </div>
              <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
              <input ref={imageCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
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

        {/* Bilder bemaßt */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Bilder bemaßt</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => measuredInputRef.current?.click()} disabled={uploadingMeasured}>
                  <ImagePlus className="h-4 w-4 mr-1" />
                  {uploadingMeasured ? "Lädt..." : "Hochladen"}
                </Button>
                {isMobile && (
                  <Button size="sm" variant="outline" onClick={() => measuredCameraRef.current?.click()} disabled={uploadingMeasured}>
                    <Camera className="h-4 w-4 mr-1" /> Kamera
                  </Button>
                )}
              </div>
              <input ref={measuredInputRef} type="file" accept="image/*" className="hidden" onChange={handleMeasuredUpload} />
              <input ref={measuredCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleMeasuredUpload} />
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {measuredImages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Noch keine bemaßten Bilder. Bild hochladen, dann im Editor bemaßen.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {measuredImages.map((img) => (
                  <div key={img.id} className="relative group rounded-lg overflow-hidden border">
                    <img
                      src={getPublicUrl(img.storage_path)}
                      alt={img.caption || "Bemaßtes Bild"}
                      className="w-full h-36 object-cover cursor-pointer"
                      onClick={() => navigate(`/projects/${projectId}/vehicle/measured/${img.id}/edit-image`)}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${projectId}/vehicle/measured/${img.id}/edit-image`)}>
                        <Pencil className="h-3 w-3 mr-1" /> Bemaßen
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive"><Trash2 className="h-3 w-3" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Bild löschen?</AlertDialogTitle>
                            <AlertDialogDescription>Das bemaßte Bild wird dauerhaft entfernt.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMeasuredImage(img)} className="bg-destructive">Löschen</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    {img.caption && (
                      <p className="text-xs text-center p-1 bg-muted truncate">{img.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Freigabe & Korrekturen zum Layout — Chat wie beim Aufmaß */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Freigabe &amp; Korrekturen zum Layout</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <LocationChat
              messages={chatMessages}
              viewerSide="employee"
              sending={sendingMsg}
              onSend={sendEmployeeMessage}
              busyId={busyFeedbackId}
              onToggleDone={async (m) => {
                const fb = feedbacks.find((f) => f.id === m.id);
                if (!fb) return;
                setBusyFeedbackId(m.id);
                await toggleFeedbackStatus(fb);
                setBusyFeedbackId(null);
              }}
              canDelete={() => true}
              onDelete={(m) => deleteFeedback(m.id)}
              placeholder="Antwort an den Kunden schreiben…"
            />
          </CardContent>
        </Card>
      </div>

      {projectId && (
        <InviteCustomerDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          projectId={projectId}
          projectNumber={project.project_number}
          heroProjectId={getHeroProjectMatchId({ id: projectId, customFields: project.custom_fields as Record<string, string> | undefined })}
        />
      )}
    </div>
  );
};

export default VehicleDetail;
