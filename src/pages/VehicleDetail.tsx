import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Upload, Trash2, FileText, Download, ImagePlus, Car, Check, X, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { deleteProjectFromSupabase } from "@/lib/supabaseSync";
import { indexedDBStorage } from "@/lib/indexedDBStorage";

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
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingLayout, setUploadingLayout] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  
  const customerAccessLink = projectId ? `${window.location.origin}/customer-login?project=${projectId}` : "";
const imageInputRef = useRef<HTMLInputElement>(null);
  const layoutInputRef = useRef<HTMLInputElement>(null);

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
      ] = await Promise.all([
        supabase.from("projects").select("id, project_number, customer_name, custom_fields, project_type").eq("id", projectId!).maybeSingle(),
        supabase.from("vehicle_field_config").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("vehicle_field_values").select("field_key, value").eq("project_id", projectId!),
        supabase.from("vehicle_images").select("*").eq("project_id", projectId!).order("created_at"),
        supabase.from("vehicle_layouts").select("*").eq("project_id", projectId!).order("uploaded_at", { ascending: false }).limit(1),
        supabase.from("vehicle_layout_feedback").select("*").eq("project_id", projectId!).order("created_at"),
      ]);

      setProject(proj);
      setFieldConfigs((configs || []) as VehicleFieldConfig[]);
      const vals: Record<string, string> = {};
      (values || []).forEach((v: any) => { vals[v.field_key] = v.value || ""; });
      setFieldValues(vals);
      setImages((imgs || []) as VehicleImage[]);
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
    for (const file of imageFiles) {
      try {
        const path = `vehicle-images/${projectId}/${crypto.randomUUID()}`;
        const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) throw uploadError;
        await supabase.from("vehicle_images").insert({
          project_id: projectId,
          storage_path: path,
          uploaded_by: session?.name || "Mitarbeiter",
        });
        uploaded++;
      } catch {}
    }
    setUploadingImage(false);
    if (uploaded > 0) {
      toast.success(`${uploaded} Bild${uploaded > 1 ? "er" : ""} hochgeladen`);
      loadAll();
    } else {
      toast.error("Upload fehlgeschlagen");
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
      const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;
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
    if (config.field_type === "dropdown") return (<div className="mb-4"><Button variant="outline" onClick={() => {navigator.clipboard.writeText(customerAccessLink); toast.success("Kundenzugangslink kopiert");}}>Kundenzugangslink kopieren</Button></div>
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
              <CardTitle className="text-base">Layout / Druckdatei</CardTitle>
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
