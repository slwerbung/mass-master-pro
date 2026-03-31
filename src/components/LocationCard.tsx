import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Pencil, ImagePlus, FileUp, FileText, ExternalLink, Loader2, MessageSquare, Check } from "lucide-react";
import { Location } from "@/types/project";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LocationInfoFields from "@/components/LocationInfoFields";
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
  status: "open" | "done";
  created_at: string;
  legacy?: boolean;
}

const LEGACY_FEEDBACK_PREFIX = "legacy-feedback-";

const isFeedbackTableUnavailable = (error: any) => {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("location_feedback") || message.includes("could not find the table");
};

interface LocationCardProps {
  location: Location;
  projectId: string;
  onDelete: (locationId: string) => void;
  onDeleteDetailImage: (locationId: string, detailImageId: string) => void;
  fieldConfigs?: any[];
}

const LocationCard = ({ location, projectId, onDelete, onDeleteDetailImage, fieldConfigs = [] }: LocationCardProps) => {
  const navigate = useNavigate();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState<string | null>(null);

  useEffect(() => {
    loadPdf();
    loadFeedbacks();

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
      const { data: urlData } = supabase.storage
        .from("project-files")
        .getPublicUrl(data.storage_path);
      setPdfUrl(urlData.publicUrl);
      setPdfName(data.file_name);
    }
  };

  const loadFeedbacks = async () => {
    const { data, error } = await (supabase as any)
      .from("location_feedback")
      .select("id, location_id, message, author_name, status, created_at")
      .eq("location_id", location.id)
      .order("created_at", { ascending: true });

    const items = !error ? ((data || []) as FeedbackItem[]) : [];
    const legacyItems = !items.length && location.guestInfo ? [{
      id: `${LEGACY_FEEDBACK_PREFIX}${location.id}`,
      location_id: location.id,
      message: location.guestInfo,
      author_name: "Historischer Kommentar",
      status: "open" as const,
      created_at: new Date(0).toISOString(),
      legacy: true,
    }] : [];

    if (error && !isFeedbackTableUnavailable(error)) {
      console.warn("loadFeedbacks error:", error.message || error);
    }

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
      const { error } = await (supabase as any)
        .from("location_feedback")
        .update({ status: nextStatus, resolved_at: nextStatus === "done" ? new Date().toISOString() : null })
        .eq("id", feedback.id);
      if (error) throw error;
      await loadFeedbacks();
      toast.success(nextStatus === "done" ? "Kommentar als umgesetzt markiert" : "Kommentar wieder geöffnet");
    } catch {
      toast.error("Kommentar konnte nicht aktualisiert werden");
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Bitte eine PDF-Datei auswählen");
      return;
    }
    setUploadingPdf(true);
    try {
      const path = `pdfs/${location.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, { upsert: true });
      if (uploadError) {
        toast.error("Upload fehlgeschlagen: " + uploadError.message);
        return;
      }
      await supabase.from("location_pdfs").delete().eq("location_id", location.id);
      const { error: dbError } = await supabase.from("location_pdfs").insert({ location_id: location.id, storage_path: path, file_name: file.name });
      if (dbError) {
        toast.error("Datenbankfehler: " + dbError.message);
        return;
      }
      toast.success("Druckdatei hochgeladen ✓");
      await loadPdf();
    } catch (err: any) {
      toast.error("Fehler: " + err.message);
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted relative cursor-pointer group" onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/edit-image`)}>
        <img src={location.imageData} alt={`Standort ${location.locationNumber}`} className="w-full h-full object-contain" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Pencil className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <h3 className="font-semibold text-base md:text-lg">Standort {location.locationNumber}</h3>
            {location.locationName && <p className="text-sm text-foreground truncate">{location.locationName}</p>}
            <p className="text-xs text-muted-foreground">Erstellt am {formatDateTimeSafe(location.createdAt)}</p>
            {location.areaMeasurements && location.areaMeasurements.length > 0 && (
              <div className="mt-1 p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 space-y-1">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Flächen</p>
                {location.areaMeasurements.map((am) => (
                  <p key={am.index} className="text-xs text-blue-600 dark:text-blue-400">
                    F {am.index}: {am.widthMm} × {am.heightMm} mm ({((am.widthMm * am.heightMm) / 1_000_000).toFixed(2)} m²)
                  </p>
                ))}
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Gesamt: {location.areaMeasurements.reduce((sum, am) => sum + (am.widthMm * am.heightMm) / 1_000_000, 0).toFixed(2)} m²
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
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Druckdatei</p>
          {pdfUrl && pdfName ? (
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
            </div>
          ) : (
            <Button size="sm" variant="outline" className="w-full" onClick={() => pdfInputRef.current?.click()} disabled={uploadingPdf}>
              {uploadingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileUp className="h-4 w-4 mr-2" />}
              {uploadingPdf ? "Lädt hoch..." : "Druckdatei hochladen"}
            </Button>
          )}
        </div>

        <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kunden-Feedback</p>
          </div>
          {feedbacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Rückmeldungen.</p>
          ) : (
            <div className="space-y-2">
              {feedbacks.map((feedback) => (
                <div key={feedback.id} className="rounded border bg-background p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{feedback.author_name}</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${feedback.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{feedback.status === "done" ? "Umgesetzt" : "Offen"}</span>
                      <Button size="sm" variant="ghost" disabled={updatingFeedbackId === feedback.id} onClick={() => toggleFeedbackDone(feedback)}>
                        <Check className="h-4 w-4 mr-1" /> {feedback.status === "done" ? "Öffnen" : "Erledigt"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{feedback.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {location.detailImages && location.detailImages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detailbilder</p>
            <div className="grid grid-cols-3 gap-2">
              {location.detailImages.map((detail) => (
                <div key={detail.id} className="relative group aspect-square bg-muted rounded overflow-hidden">
                  <img src={detail.imageData} alt={detail.caption || "Detailbild"}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/details/${detail.id}/edit-image`)} />
                  {detail.caption && <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">{detail.caption}</div>}
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

        <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(`/projects/${projectId}/camera?detail=true&locationId=${location.id}`)}>
          <ImagePlus className="h-4 w-4 mr-2" /> Detailbild hinzufügen
        </Button>
      </CardContent>

      <input ref={pdfInputRef} type="file" accept="application/pdf" onChange={handlePdfUpload} className="hidden" />
    </Card>
  );
};

export default LocationCard;
