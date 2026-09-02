import { useRef, useState, useEffect } from "react";
import { useDirectCamera } from "@/lib/useDirectCamera";
import { useNavigate } from "react-router-dom";
import { setEditorHandoff } from "@/lib/editorHandoff";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Pencil, ImagePlus, FileUp, FileText, ExternalLink, Loader2, MessageSquare, Check, CheckCheck, Clock, Maximize2, X, Plus, Ruler } from "lucide-react";
import { LocationApprovalMedia } from "@/components/LocationApprovalMedia";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Location, AreaMeasurement } from "@/types/project";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { scheduleSyncProject } from "@/lib/supabaseSync";
import { updateHeroNotesIfLinked } from "@/lib/heroNotesSync";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LocationInfoFields from "@/components/LocationInfoFields";
import LocationChat, { ChatMessage } from "@/components/LocationChat";
import { getSession } from "@/lib/session";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface FeedbackItem {
  id: string;
  location_id: string;
  message: string;
  author_name: string;
  author_type?: string;
  status: "open" | "done";
  created_at: string;
  legacy?: boolean;
}

const LEGACY_FEEDBACK_PREFIX = "legacy-feedback-";

const isFeedbackTableUnavailable = (error: any) => {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("location_feedback") || message.includes("could not find the table");
};
const isSupportedPrintFile = (file: File) => {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return mime === "application/pdf"
    || mime.startsWith("image/")
    || name.endsWith(".pdf")
    || name.endsWith(".png")
    || name.endsWith(".jpg")
    || name.endsWith(".jpeg")
    || name.endsWith(".webp")
    || name.endsWith(".svg")
    || name.endsWith(".ai")
    || name.endsWith(".eps");
};


interface LocationCardProps {
  location: Location;
  projectId: string;
  onDelete: (locationId: string) => void;
  onDeleteDetailImage: (locationId: string, detailImageId: string) => void;
  fieldConfigs?: any[];
  showPrintFiles?: boolean;
  showDetailImages?: boolean;
  project?: any;
  projectFieldConfigs?: any[];
}

const LocationCard = ({ location, projectId, onDelete, onDeleteDetailImage, fieldConfigs = [], showPrintFiles = true, showDetailImages = true, project, projectFieldConfigs = [] }: LocationCardProps) => {
  const navigate = useNavigate();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const isMobile = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const { cameraInput: detailCameraInput, triggerCamera: triggerDetailCamera } = useDirectCamera({
    onCapture: (imageData) => { setEditorHandoff({ imageData }); navigate(`/projects/${projectId}/editor?detail=true&locationId=${location.id}`); },
  });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  // Large-view overlay for looking at an image without opening the editor.
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState<string | null>(null);
  const [approvalCount, setApprovalCount] = useState<{ total: number; approved: number } | null>(null);

  // Editable area-measurement list. Areas are identified by their `index`
  // (F1, F2, …) which is baked into the annotated image, so we never renumber
  // on edit/delete — the number is an identity, not a position. A local copy
  // is shown so edits appear instantly; it re-syncs when the location prop
  // changes (e.g. after a background sync refreshes the parent).
  const [areas, setAreas] = useState<AreaMeasurement[]>(location.areaMeasurements ?? []);
  const [areaEditOpen, setAreaEditOpen] = useState(false);
  const [draftAreas, setDraftAreas] = useState<{ index: number; widthMm: string; heightMm: string }[]>([]);
  const [savingAreas, setSavingAreas] = useState(false);

  useEffect(() => {
    setAreas(location.areaMeasurements ?? []);
  }, [location.areaMeasurements]);

  const openAreaEditor = () => {
    setDraftAreas(areas.map((a) => ({ index: a.index, widthMm: String(a.widthMm), heightMm: String(a.heightMm) })));
    setAreaEditOpen(true);
  };

  const updateDraftArea = (index: number, field: "widthMm" | "heightMm", value: string) => {
    setDraftAreas((prev) => prev.map((d) => (d.index === index ? { ...d, [field]: value } : d)));
  };

  const removeDraftArea = (index: number) => {
    setDraftAreas((prev) => prev.filter((d) => d.index !== index));
  };

  const addDraftArea = () => {
    // New areas continue the F-numbering from the current maximum.
    const maxIndex = draftAreas.reduce((m, d) => Math.max(m, d.index), 0);
    setDraftAreas((prev) => [...prev, { index: maxIndex + 1, widthMm: "", heightMm: "" }]);
  };

  const saveAreaEdits = async () => {
    const cleaned: AreaMeasurement[] = [];
    for (const d of draftAreas) {
      const w = Math.round(parseFloat(d.widthMm));
      const h = Math.round(parseFloat(d.heightMm));
      if (!(w > 0) || !(h > 0)) {
        toast.error(`F ${d.index}: bitte gültige Breite und Höhe eingeben`);
        return;
      }
      cleaned.push({ index: d.index, widthMm: w, heightMm: h });
    }
    cleaned.sort((a, b) => a.index - b.index);
    setSavingAreas(true);
    try {
      await indexedDBStorage.updateLocationMetadata(projectId, location.id, { areaMeasurements: cleaned });
      setAreas(cleaned);
      setAreaEditOpen(false);
      scheduleSyncProject(projectId);
      // Keep HERO's project notes in step with the corrected measurements.
      updateHeroNotesIfLinked(projectId).catch((e) => console.warn("HERO notes sync failed:", e));
      toast.success("Flächen aktualisiert");
    } catch (e) {
      console.error("Area save failed:", e);
      toast.error("Flächen konnten nicht gespeichert werden");
    } finally {
      setSavingAreas(false);
    }
  };

  const draftTotalM2 = draftAreas.reduce((sum, d) => {
    const w = parseFloat(d.widthMm), h = parseFloat(d.heightMm);
    return sum + (w > 0 && h > 0 ? (w * h) / 1_000_000 : 0);
  }, 0);

  const loadApprovals = async () => {
    const { data } = await supabase
      .from("location_approvals")
      .select("approved")
      .eq("location_id", location.id);
    if (data) {
      setApprovalCount({ total: data.length, approved: data.filter((r: any) => r.approved).length });
    }
  };

  useEffect(() => {
    loadPdf();
    loadFeedbacks();
    loadApprovals();

    const channel = supabase
      .channel(`location-feedback-${location.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "location_feedback", filter: `location_id=eq.${location.id}` },
        () => {
          loadFeedbacks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [location.id, location.guestInfo]);

  const loadPdf = async () => {
    const { data, error } = await supabase
      .from("location_pdfs")
      .select("storage_path, file_name")
      .eq("location_id", location.id)
      .maybeSingle();
    if (error) console.warn("loadPdf error:", error.message);
    if (data) {
      const { data: signedData } = await supabase.storage
        .from("project-files")
        .createSignedUrl(data.storage_path, 3600);
      setPdfUrl(signedData?.signedUrl || null);
      setPdfName(data.file_name);
    }
  };

  // Staff read/write of the Standort-Chat goes through the location-feedback
  // edge function. After the Phase-2 RLS lockdown the anon/expired-session
  // client can no longer read or write location_feedback directly, so an
  // employee's message "kam nicht an". The function validates the HMAC session
  // token and performs the operation with the service role.
  const invokeFeedback = async (action: string, extra: Record<string, unknown> = {}) => {
    const token = getSession()?.authToken;
    const { data, error } = await supabase.functions.invoke("location-feedback", {
      body: { token, action, locationId: location.id, ...extra },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadFeedbacks = async () => {
    let items: FeedbackItem[] = [];
    try {
      const data = await invokeFeedback("list");
      items = (data?.messages || []) as FeedbackItem[];
    } catch (e: any) {
      if (!isFeedbackTableUnavailable(e)) {
        console.warn("loadFeedbacks error:", e?.message || e);
      }
    }

    const legacyItems = !items.length && location.guestInfo ? [{
      id: `${LEGACY_FEEDBACK_PREFIX}${location.id}`,
      location_id: location.id,
      message: location.guestInfo,
      author_name: "Historischer Kommentar",
      status: "open" as const,
      created_at: new Date(0).toISOString(),
      legacy: true,
    }] : [];

    setFeedbacks([...items, ...legacyItems]);
  };

  const toggleFeedbackDone = async (feedback: FeedbackItem) => {
    if (feedback.legacy) {
      toast.error("Legacy-Kundenhinweise können hier nicht als umgesetzt markiert werden");
      return;
    }
    setUpdatingFeedbackId(feedback.id);
    try {
      const nextStatus = feedback.status === "done" ? "open" : "done";
      await invokeFeedback("toggle", { id: feedback.id, status: nextStatus });
      await loadFeedbacks();
      toast.success(nextStatus === "done" ? "Kommentar als umgesetzt markiert" : "Kommentar wieder geöffnet");
    } catch {
      toast.error("Kommentar konnte nicht aktualisiert werden");
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  const [sendingMsg, setSendingMsg] = useState(false);
  const sendEmployeeMessage = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setSendingMsg(true);
    try {
      await invokeFeedback("send", { message, name: getSession()?.name || "Mitarbeiter" });
      await loadFeedbacks();
    } catch (e: any) {
      toast.error("Nachricht konnte nicht gesendet werden: " + (e?.message || "Fehler"));
    } finally {
      setSendingMsg(false);
    }
  };

  const deleteOwnMessage = async (m: ChatMessage) => {
    if (m.legacy) return;
    setUpdatingFeedbackId(m.id);
    try {
      await invokeFeedback("delete", { id: m.id });
      await loadFeedbacks();
    } catch (e: any) {
      toast.error("Löschen fehlgeschlagen");
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  const handlePrintFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isSupportedPrintFile(file)) {
      toast.error("Bitte eine PDF- oder Bilddatei auswählen");
      return;
    }
    setUploadingPdf(true);
    try {
      // Sanitize filename for Supabase Storage. The bucket rejects keys
      // with non-ASCII characters, spaces, parentheses, and several
      // other punctuation marks with "Invalid key". German filenames
      // commonly contain umlauts (ä ö ü ß) and spaces - "Produktionsdatei
      // für Standort 1 (final).pdf" would fail. We replace umlauts
      // with ASCII equivalents and strip anything else that isn't a
      // safe key character. We keep the original name in the DB so
      // the user-facing filename stays intact.
      const safeName = file.name
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/Ä/g, "Ae")
        .replace(/Ö/g, "Oe")
        .replace(/Ü/g, "Ue")
        .replace(/ß/g, "ss")
        .replace(/[^A-Za-z0-9._-]/g, "_") // anything else → underscore
        .replace(/_+/g, "_")               // collapse runs of underscores
        .replace(/^_+|_+$/g, "");          // trim leading/trailing underscores

      const path = `pdfs/${location.id}/${Date.now()}_${safeName}`;
      // We clean up the old row + storage file first, then insert a
      // fresh one. We don't use { upsert: true } on the storage call
      // because that triggers a SELECT under the hood to check if
      // the object exists, and project-files has INSERT/UPDATE/DELETE
      // policies for anon but no SELECT policy - so upsert returns
      // "row-level security" errors even though pure INSERT would work.
      // Since the path includes Date.now() it's unique per upload
      // anyway, so upsert isn't needed.

      // 1. Remove old DB row + the old storage file it references, so
      //    we don't leak storage objects when the user replaces a file.
      const { data: oldRows } = await supabase
        .from("location_pdfs")
        .select("storage_path")
        .eq("location_id", location.id);
      const oldPaths = (oldRows || []).map((r: any) => r.storage_path).filter(Boolean);
      if (oldPaths.length > 0) {
        await supabase.storage.from("project-files").remove(oldPaths);
        await supabase.from("location_pdfs").delete().eq("location_id", location.id);
      }

      // 2. Upload the new file (no upsert; path is unique).
      const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file);
      if (uploadError) {
        toast.error("Upload fehlgeschlagen: " + uploadError.message);
        return;
      }
      const { error: dbError } = await supabase.from("location_pdfs").insert({ location_id: location.id, storage_path: path, file_name: file.name });
      if (dbError) {
        toast.error("Datenbankfehler: " + dbError.message);
        return;
      }
      toast.success("Datei hochgeladen ✓");
      await loadPdf();
    } catch (err: any) {
      toast.error("Fehler: " + err.message);
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const handleDeletePrintFile = async () => {
    setUploadingPdf(true);
    try {
      // Remove the storage object(s) first, then the DB row(s), so we
      // don't leak files in the bucket.
      const { data: rows } = await supabase
        .from("location_pdfs")
        .select("storage_path")
        .eq("location_id", location.id);
      const paths = (rows || []).map((r: any) => r.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from("project-files").remove(paths);
      }
      const { error: dbError } = await supabase
        .from("location_pdfs")
        .delete()
        .eq("location_id", location.id);
      if (dbError) {
        toast.error("Löschen fehlgeschlagen: " + dbError.message);
        return;
      }
      setPdfUrl(null);
      setPdfName(null);
      toast.success("Datei gelöscht ✓");
    } catch (err: any) {
      toast.error("Fehler: " + err.message);
    } finally {
      setUploadingPdf(false);
    }
  };

  // Freigabe-Status spiegelt EXAKT die Kundenansicht: dort ist ein Standort
  // nur „freigegeben“ (grün) oder eben nicht. Es gibt keinen separaten
  // „Korrektur“-Status – Korrekturwünsche stehen als Chat-Nachrichten
  // darunter. Deshalb zeigen wir hier genau zwei Zustände: „Freigegeben“
  // (alle Freigabe-Zeilen approved) oder „Offen“. Ohne jegliche
  // Kundenaktivität zeigen wir keinen Badge.
  const hasApprovalRows = approvalCount !== null && approvalCount.total > 0;
  const fullyApproved = hasApprovalRows && approvalCount!.approved === approvalCount!.total;
  const hasCustomerFeedback = feedbacks.some((f) => f.author_type === "customer");
  const approvalState: "approved" | "open" | null =
    fullyApproved ? "approved"
    : (hasApprovalRows || hasCustomerFeedback) ? "open"
    : null;

  return (
    <Card className="overflow-hidden">
      {pdfUrl ? (
        <div className="p-3 pb-0">
          <LocationApprovalMedia
            annotatedUrl={location.imageData}
            pdfs={[{ url: pdfUrl, name: pdfName || "Produktionsdatei" }]}
          />
        </div>
      ) : (
        <div className="min-h-[180px] bg-muted relative cursor-pointer group rounded-lg overflow-hidden flex items-center justify-center" onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/edit-image`)}>
          <img src={location.imageData} alt={`Standort ${location.locationNumber}`} className="w-full h-auto max-h-[70vh] object-contain" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Pencil className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          {/* Always-visible "view large" (no editing). */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightbox(location.imageData); }}
            className="absolute top-2 right-2 z-10 rounded-md bg-black/55 hover:bg-black/75 text-white p-1.5"
            title="Groß ansehen (ohne bearbeiten)"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      )}
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base md:text-lg">Standort {location.locationNumber}</h3>
              {approvalState === "approved" && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium">
                  <CheckCheck className="h-3 w-3" /> Freigegeben
                </span>
              )}
              {approvalState === "open" && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                  <Clock className="h-3 w-3" /> Offen
                </span>
              )}
            </div>
            {location.locationName && <p className="text-sm text-foreground truncate">{location.locationName}</p>}
            <p className="text-xs text-muted-foreground">Erstellt am {formatDateTimeSafe(location.createdAt)}</p>
            {areas.length > 0 && (
              <div className="mt-1 p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Flächen</p>
                  <button
                    type="button"
                    onClick={openAreaEditor}
                    className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:underline"
                    title="Flächenmaße bearbeiten"
                  >
                    <Pencil className="h-3 w-3" /> Bearbeiten
                  </button>
                </div>
                {areas.map((am) => (
                  <p key={am.index} className="text-xs text-blue-600 dark:text-blue-400">
                    F {am.index}: {am.widthMm} × {am.heightMm} mm ({((am.widthMm * am.heightMm) / 1_000_000).toFixed(2)} m²)
                  </p>
                ))}
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Gesamt: {areas.reduce((sum, am) => sum + (am.widthMm * am.heightMm) / 1_000_000, 0).toFixed(2)} m²
                </p>
              </div>
            )}
            <LocationInfoFields
              location={{
                location_name: location.locationName,
                system: location.system,
                label: location.label,
                location_type: location.locationType,
                comment: location.comment,
                customFields: location.customFields,
              }}
              fields={fieldConfigs}
              project={project}
              projectFields={projectFieldConfigs}
            />
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/edit`)}>
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Standort löschen?</AlertDialogTitle>
                  <AlertDialogDescription>Diese Aktion kann nicht rückgängig gemacht werden.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(location.id)} className="bg-destructive">Löschen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Layout / Produktionsdatei</p>
          {showPrintFiles ? (
            pdfUrl && pdfName ? (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm truncate flex-1">{pdfName}</span>
                <Button size="sm" variant="outline" asChild>
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" /> Öffnen
                  </a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => pdfInputRef.current?.click()} disabled={uploadingPdf} title="Ersetzen">
                  <FileUp className="h-3 w-3" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" disabled={uploadingPdf} title="Löschen">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Datei löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        „{pdfName}" wird dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeletePrintFile} className="bg-destructive">Löschen</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="w-full" onClick={() => pdfInputRef.current?.click()} disabled={uploadingPdf}>
                {uploadingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileUp className="h-4 w-4 mr-2" />}
                {uploadingPdf ? "Lädt hoch..." : "Datei hochladen"}
              </Button>
            )
          ) : (
            <p className="text-sm text-muted-foreground">In der internen Ansicht ausgeblendet.</p>
          )}
        </div>

        <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Standort-Chat</p>
          </div>
          <LocationChat
            messages={feedbacks as ChatMessage[]}
            viewerSide="employee"
            sending={sendingMsg}
            onSend={sendEmployeeMessage}
            onToggleDone={(m) => toggleFeedbackDone(m as FeedbackItem)}
            canDelete={(m) => !m.legacy}
            onDelete={deleteOwnMessage}
            busyId={updatingFeedbackId}
            placeholder="Antwort an den Kunden…"
          />
        </div>

        {showDetailImages && location.detailImages && location.detailImages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detailbilder</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {location.detailImages.map((detail) => (
                <div key={detail.id} className="relative group bg-muted rounded overflow-hidden flex items-center justify-center min-h-[140px]">
                  <img src={detail.imageData} alt={detail.caption || "Detailbild"}
                    className="w-full h-auto max-h-[240px] object-contain cursor-pointer"
                    onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/details/${detail.id}/edit-image`)} />
                  {/* Always-visible "view large" (no editing). */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLightbox(detail.imageData); }}
                    className="absolute bottom-1 right-1 z-10 rounded-md bg-black/55 hover:bg-black/75 text-white p-1"
                    title="Groß ansehen (ohne bearbeiten)"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  {detail.caption && <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate pr-8">{detail.caption}</div>}
                  <Button variant="ghost" size="sm" className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 h-6 w-6 p-0 bg-muted/80 hover:bg-muted text-foreground rounded-none rounded-br" onClick={(e) => { e.stopPropagation(); navigate(`/projects/${projectId}/locations/${location.id}/details/${detail.id}/edit`); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 h-6 w-6 p-0 bg-destructive/80 hover:bg-destructive text-white rounded-none rounded-bl">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Detailbild löschen?</AlertDialogTitle>
                        <AlertDialogDescription>Diese Aktion kann nicht rückgängig gemacht werden.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDeleteDetailImage(location.id, detail.id)} className="bg-destructive">Löschen</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </div>
        )}

        {showDetailImages && (<Button variant="outline" size="sm" className="w-full" onClick={() => { if (isMobile) { triggerDetailCamera(); } else { navigate(`/projects/${projectId}/camera?detail=true&locationId=${location.id}`); } }}>
          <ImagePlus className="h-4 w-4 mr-2" /> Detailbild hinzufügen
        </Button>)}
      </CardContent>

      {detailCameraInput}
      <input ref={pdfInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.ai,.eps" onChange={handlePrintFileUpload} className="hidden" />

      {/* Lightbox: view an image large without opening the editor */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Großansicht" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          <Button variant="secondary" size="icon" className="absolute top-4 right-4" onClick={() => setLightbox(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Edit the measured areas after the fact (correct a wrong laser value,
          remove a mis-measured area). Numbers (F1, F2, …) are preserved. */}
      <Dialog open={areaEditOpen} onOpenChange={(o) => { if (!o) setAreaEditOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ruler className="h-4 w-4" /> Flächen bearbeiten
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {draftAreas.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine Flächen. Mit „Fläche hinzufügen“ eine neue anlegen.</p>
            )}
            {draftAreas.map((d) => {
              const w = parseFloat(d.widthMm), h = parseFloat(d.heightMm);
              const m2 = w > 0 && h > 0 ? (w * h) / 1_000_000 : 0;
              return (
                <div key={d.index} className="flex items-end gap-2">
                  <div className="w-8 shrink-0 pb-2 text-sm font-semibold text-blue-700 dark:text-blue-300">F{d.index}</div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Breite mm</label>
                    <Input type="number" inputMode="decimal" value={d.widthMm}
                      onChange={(e) => updateDraftArea(d.index, "widthMm", e.target.value)} />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Höhe mm</label>
                    <Input type="number" inputMode="decimal" value={d.heightMm}
                      onChange={(e) => updateDraftArea(d.index, "heightMm", e.target.value)} />
                  </div>
                  <div className="w-12 shrink-0 pb-2 text-right text-xs text-muted-foreground">{m2 > 0 ? m2.toFixed(2) : "–"}</div>
                  <Button variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => removeDraftArea(d.index)} title="Fläche entfernen">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button variant="outline" size="sm" className="w-full" onClick={addDraftArea}>
              <Plus className="h-4 w-4 mr-1" /> Fläche hinzufügen
            </Button>
            {draftAreas.length > 0 && (
              <p className="text-sm font-semibold text-right">Gesamt: {draftTotalM2.toFixed(2)} m²</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAreaEditOpen(false)} disabled={savingAreas}>Abbrechen</Button>
            <Button onClick={saveAreaEdits} disabled={savingAreas}>
              {savingAreas ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Speichert…</> : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default LocationCard;
