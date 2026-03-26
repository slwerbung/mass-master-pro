import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogOut, Save, ArrowLeft, CheckCheck, FileText, Pencil, Check, Trash2, Upload, Download } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { toast } from "sonner";
import { getSession, clearSession, setSession } from "@/lib/session";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import LocationInfoFields from "@/components/LocationInfoFields";

interface FieldConfig {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  is_active: boolean;
  customer_visible: boolean;
  sort_order: number;
}

interface FeedbackItem {
  id: string;
  location_id: string;
  message: string;
  author_name: string;
  author_customer_id: string | null;
  status: "open" | "done";
  created_at: string;
  resolved_at: string | null;
  legacy?: boolean;
}

const LEGACY_FEEDBACK_PREFIX = "legacy-feedback-";
const DIRECT_ASSIGNMENT_ID_PREFIX = "direct-project-";

const isFeedbackTableUnavailable = (error: any) => {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("location_feedback") || message.includes("could not find the table");
};

const isRealCustomerId = (value?: string | null) => !!value && !String(value).startsWith("guest:");

const CustomerView = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = getSession();
  const directProjectId = searchParams.get("project");
  const guestToken = typeof window !== "undefined" ? localStorage.getItem("guest_token") : null;
  const guestProjectNumber = typeof window !== "undefined" ? localStorage.getItem("guest_project_number") : null;

  const [assignments, setAssignments] = useState<any[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<string, FeedbackItem[]>>({});
  const [draftFeedback, setDraftFeedback] = useState<Record<string, string>>({});
  const [editingFeedbackId, setEditingFeedbackId] = useState<Record<string, string | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [savingApprovals, setSavingApprovals] = useState(false);
  const [customerUploads, setCustomerUploads] = useState<any[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "customer") { navigate("/"); return; }
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!directProjectId || selectedAssignment) return;
    const match = assignments.find((a) => a.project_id === directProjectId);
    if (match) {
      loadLocations(match);
      return;
    }
    if (guestToken) {
      loadDirectGuestProject(directProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, directProjectId, selectedAssignment, guestToken]);

  const visibleFields = useMemo(() => mergeWithDefaultLocationFields(fields).filter((f) => f.is_active && f.customer_visible), [fields]);

  const parseLegacyFeedback = (loc: any): FeedbackItem[] => {
    const raw = String(loc?.guest_info || "").trim();
    if (!raw) return [];
    return [{
      id: `${LEGACY_FEEDBACK_PREFIX}${loc.id}`,
      location_id: loc.id,
      message: raw,
      author_name: "Historischer Kommentar",
      author_customer_id: null,
      status: "open",
      created_at: new Date(0).toISOString(),
      resolved_at: null,
      legacy: true,
    }];
  };

  const buildLegacyFeedbackMap = (locs: any[]) => {
    const map: Record<string, FeedbackItem[]> = {};
    (locs || []).forEach((loc: any) => {
      const entries = parseLegacyFeedback(loc);
      if (entries.length > 0) map[loc.id] = entries;
    });
    return map;
  };

  const getSelectedProjectId = () => selectedAssignment?.project_id || directProjectId || null;
  const isDirectGuestMode = !!selectedAssignment?.direct || (!!directProjectId && !assignments.some((a) => a.project_id === directProjectId));

  const saveLegacyFeedback = async (locationId: string, message: string) => {
    const projectId = getSelectedProjectId();
    if (!projectId) throw new Error("missing-project");

    if (guestToken) {
      const { data, error } = await supabase.functions.invoke("update-guest-info", {
        body: { projectId, token: guestToken, locationId, guestInfo: message },
      });
      if (error || data?.error) throw error || new Error(data?.error || "legacy-save-failed");
      return;
    }

    if (!selectedAssignment || !session || !isRealCustomerId(session.id)) {
      throw new Error("missing-session");
    }

    const { data, error } = await supabase.functions.invoke("customer-data", {
      body: {
        action: "update_guest_info",
        customerId: session.id,
        assignmentId: selectedAssignment.id,
        locationId,
        guestInfo: message,
      },
    });

    if (error || data?.error) throw error || new Error(data?.error || "legacy-save-failed");
  };

  const ensureDirectProjectAssignment = async (projectId: string) => {
    if (!session?.name) return null;
    try {
      const { data, error } = await supabase.functions.invoke("ensure-customer-assignment", {
        body: { projectId, customerName: session.name },
      });
      if (error || !data?.success || !data?.customer?.id) return null;
      const upgradedSession = { role: "customer" as const, id: data.customer.id, name: data.customer.name || session.name };
      setSession(upgradedSession);
      return upgradedSession;
    } catch {
      return null;
    }
  };

  const loadInitial = async () => {
    setLoading(true);
    try {
      const [{ data: fieldData }, assignmentResult] = await Promise.all([
        (supabase as any).from("location_field_config").select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order").order("sort_order"),
        isRealCustomerId(session?.id)
          ? supabase.from("customer_project_assignments").select("id, project_id, projects(id, project_number)").eq("customer_id", session!.id)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      setFields(mergeWithDefaultLocationFields((fieldData || []) as FieldConfig[]));

      if (assignmentResult?.error) throw assignmentResult.error;
      let loadedAssignments = assignmentResult?.data || [];

      if (directProjectId && !loadedAssignments.some((a: any) => a.project_id === directProjectId) && session?.name) {
        const ensuredSession = await ensureDirectProjectAssignment(directProjectId);
        const customerIdForReload = ensuredSession?.id || (isRealCustomerId(session?.id) ? session!.id : null);
        if (customerIdForReload) {
          const refreshed = await supabase.from("customer_project_assignments").select("id, project_id, projects(id, project_number)").eq("customer_id", customerIdForReload);
          loadedAssignments = refreshed.data || loadedAssignments;
        }
      }

      setAssignments(loadedAssignments);

      if ((!loadedAssignments || loadedAssignments.length === 0) && directProjectId && guestToken) {
        await loadDirectGuestProject(directProjectId);
      }
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  const loadDirectGuestProject = async (projectId: string) => {
    if (!guestToken) return;
    setSelectedAssignment({
      id: `${DIRECT_ASSIGNMENT_ID_PREFIX}${projectId}`,
      project_id: projectId,
      projects: { id: projectId, project_number: guestProjectNumber || "Direktlink" },
      direct: true,
    });
    setLoading(true);
    try {
      const [{ data: fieldData }, response] = await Promise.all([
        (supabase as any).from("location_field_config").select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order").order("sort_order"),
        supabase.functions.invoke("guest-data", { body: { projectId, token: guestToken } }),
      ]);

      setFields(mergeWithDefaultLocationFields((fieldData || []) as FieldConfig[]));
      const payload = response.data || {};
      if (response.error || payload?.error) throw response.error || new Error(payload.error || "guest-load-failed");

      const locs = payload.locations || [];
      const imgs = payload.images || [];
      const pdfs = payload.pdfs || [];
      const locationIds = locs.map((l: any) => l.id);
      setLocations(locs);
      setImages([...(imgs || []), ...((pdfs || []).map((p: any) => ({ ...p, image_type: "pdf" })))]);
      setApprovals({});
      if (session?.id && isRealCustomerId(session.id)) {
        await loadCustomerUploads(projectId);
      } else {
        setCustomerUploads([]);
      }

      if (locationIds.length > 0) {
        const feedbackMap: Record<string, FeedbackItem[]> = {};
        const payloadFeedbacks = payload.feedbacks || [];
        if (payloadFeedbacks.length > 0) {
          payloadFeedbacks.forEach((entry: any) => {
            if (!feedbackMap[entry.location_id]) feedbackMap[entry.location_id] = [];
            feedbackMap[entry.location_id].push(entry as FeedbackItem);
          });
        } else {
          const feedbackResponse = await (supabase as any).from("location_feedback").select("*").in("location_id", locationIds).order("created_at");
          if (!feedbackResponse.error) {
            (feedbackResponse.data || []).forEach((entry: any) => {
              if (!feedbackMap[entry.location_id]) feedbackMap[entry.location_id] = [];
              feedbackMap[entry.location_id].push(entry as FeedbackItem);
            });
          }
        }
        for (const [locationId, entries] of Object.entries(buildLegacyFeedbackMap(locs))) {
          if ((feedbackMap[locationId] || []).length === 0) {
            feedbackMap[locationId] = [...entries];
          }
        }
        setFeedbacks(feedbackMap);
      } else {
        setFeedbacks({});
      }
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async (assignment: any) => {
    if (assignment?.direct) {
      await loadDirectGuestProject(assignment.project_id);
      return;
    }

    setSelectedAssignment(assignment);
    setLoading(true);
    loadCustomerUploads(assignment.project_id);
    try {
      const { data: locs, error } = await supabase
        .from("locations")
        .select("id, location_number, location_name, comment, system, label, location_type, guest_info, custom_fields")
        .eq("project_id", assignment.project_id)
        .order("created_at");
      if (error) throw error;
      const locationIds = (locs || []).map((l: any) => l.id);
      setLocations(locs || []);

      if (locationIds.length > 0) {
        const [{ data: imgs }, { data: pdfs }, { data: approvData }, feedbackResponse] = await Promise.all([
          supabase.from("location_images").select("location_id, image_type, storage_path").in("location_id", locationIds),
          supabase.from("location_pdfs").select("id, location_id, storage_path, file_name").in("location_id", locationIds),
          supabase.from("location_approvals").select("location_id, approved").eq("assignment_id", assignment.id).in("location_id", locationIds),
          (supabase as any).from("location_feedback").select("*").in("location_id", locationIds).order("created_at"),
        ]);

        const pdfEntries = (pdfs || []).map((p: any) => ({ location_id: p.location_id, image_type: "pdf", storage_path: p.storage_path, file_name: p.file_name, id: p.id }));
        setImages([...(imgs || []), ...pdfEntries]);

        const approvMap: Record<string, boolean> = {};
        (approvData || []).forEach((a: any) => { approvMap[a.location_id] = a.approved; });
        setApprovals(approvMap);

        const feedbackMap: Record<string, FeedbackItem[]> = {};
        if (!feedbackResponse.error) {
          (feedbackResponse.data || []).forEach((entry: any) => {
            if (!feedbackMap[entry.location_id]) feedbackMap[entry.location_id] = [];
            feedbackMap[entry.location_id].push(entry as FeedbackItem);
          });
        }
        for (const [locationId, entries] of Object.entries(buildLegacyFeedbackMap(locs || []))) {
          feedbackMap[locationId] = [...(feedbackMap[locationId] || []), ...entries];
        }
        setFeedbacks(feedbackMap);
      } else {
        setImages([]);
        setApprovals({});
        setFeedbacks({});
      }
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  const reloadFeedbacks = async (locationIds: string[]) => {
    if (locationIds.length === 0) return;
    const response = await (supabase as any).from("location_feedback").select("*").in("location_id", locationIds).order("created_at");
    const feedbackMap: Record<string, FeedbackItem[]> = {};
    if (!response.error) {
      (response.data || []).forEach((entry: any) => {
        if (!feedbackMap[entry.location_id]) feedbackMap[entry.location_id] = [];
        feedbackMap[entry.location_id].push(entry as FeedbackItem);
      });
    }
    const relevantLocations = locations.filter((loc) => locationIds.includes(loc.id));
    for (const [locationId, entries] of Object.entries(buildLegacyFeedbackMap(relevantLocations))) {
      if ((feedbackMap[locationId] || []).length === 0) {
        feedbackMap[locationId] = [...entries];
      }
    }
    setFeedbacks((prev) => ({ ...prev, ...feedbackMap }));
  };

  useEffect(() => {
    const locationIds = locations.map((loc) => loc.id);
    if (locationIds.length === 0) return;

    const channel = supabase
      .channel(`customer-feedback-${getSelectedProjectId() || "project"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "location_feedback" },
        (payload) => {
          const changedLocationId = (payload.new as any)?.location_id || (payload.old as any)?.location_id;
          if (changedLocationId && locationIds.includes(changedLocationId)) {
            reloadFeedbacks([changedLocationId]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [locations, selectedAssignment, directProjectId]);

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    return data.publicUrl;
  };

  const triggerNotification = async (changeType: "approval" | "comment") => {
    if (!selectedAssignment || selectedAssignment.direct) return;
    try {
      await supabase.functions.invoke("send-notification", {
        body: {
          assignmentId: selectedAssignment.id,
          customerName: session?.name || "Unbekannt",
          projectNumber: selectedAssignment.projects?.project_number || "",
          changeType,
        },
      });
    } catch (e) {
      console.warn("Notification failed (non-fatal):", e);
    }
  };

  const saveFeedback = async (locationId: string) => {
    const message = (draftFeedback[locationId] || "").trim();
    if (!message) return;
    setSavingId(locationId);
    try {
      const editId = editingFeedbackId[locationId];
      const isLegacyEdit = !!editId && editId.startsWith(LEGACY_FEEDBACK_PREFIX);
      let savedEntry: FeedbackItem | null = null;

      if (isDirectGuestMode && guestToken) {
        const { data, error } = await supabase.functions.invoke("update-guest-info", {
          body: {
            projectId: getSelectedProjectId(),
            token: guestToken,
            locationId,
            guestInfo: message,
            authorName: session?.name || localStorage.getItem("guest_name") || "Kunde",
            feedbackId: isLegacyEdit ? null : (editId || null),
          },
        });
        if (error || data?.error) throw error || new Error(data?.error || "guest-feedback-save-failed");
        savedEntry = data?.feedback || null;
      } else if (editId && !isLegacyEdit) {
        const { data, error } = await supabase.functions.invoke("customer-data", {
          body: {
            action: "update_feedback",
            customerId: session?.id,
            assignmentId: selectedAssignment?.id,
            locationId,
            feedbackId: editId,
            message,
          },
        });
        if (error || data?.error) throw error || new Error(data?.error || "update-feedback-failed");
        savedEntry = data?.feedback || null;
      } else if (isLegacyEdit) {
        const { data, error } = await supabase.functions.invoke("customer-data", {
          body: {
            action: "create_feedback",
            customerId: session?.id,
            assignmentId: selectedAssignment?.id,
            locationId,
            message,
            authorName: session?.name || "Kunde",
          },
        });
        if (error || data?.error) throw error || new Error(data?.error || "create-feedback-failed");
        savedEntry = data?.feedback || null;
      } else {
        const { data, error } = await supabase.functions.invoke("customer-data", {
          body: {
            action: "create_feedback",
            customerId: session?.id,
            assignmentId: selectedAssignment?.id,
            locationId,
            message,
            authorName: session?.name || "Kunde",
          },
        });
        if (error || data?.error) throw error || new Error(data?.error || "create-feedback-failed");
        savedEntry = data?.feedback || null;
      }

      if (savedEntry) {
        setFeedbacks((prev) => {
          const existing = (prev[locationId] || []).filter((entry) => entry.id !== savedEntry!.id && entry.id !== `${LEGACY_FEEDBACK_PREFIX}${locationId}`);
          return {
            ...prev,
            [locationId]: [...existing, savedEntry!].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
          };
        });
      } else {
        await reloadFeedbacks([locationId]);
      }

      setDraftFeedback((prev) => ({ ...prev, [locationId]: "" }));
      setEditingFeedbackId((prev) => ({ ...prev, [locationId]: null }));
      toast.success("Hinweis gespeichert");
      triggerNotification("comment");
    } catch (error) {
      console.error("saveFeedback failed", error);
      toast.error("Fehler beim Speichern");
    } finally {
      setSavingId(null);
    }
  };

  const startEditFeedback = (locationId: string, feedback: FeedbackItem) => {
    setEditingFeedbackId((prev) => ({ ...prev, [locationId]: feedback.id }));
    setDraftFeedback((prev) => ({ ...prev, [locationId]: feedback.message }));
  };

  const deleteFeedback = async (locationId: string, feedbackId: string) => {
    if (feedbackId.startsWith(LEGACY_FEEDBACK_PREFIX)) return;
    // Resolve assignmentId — fallback to first matching assignment if selectedAssignment not set
    const assignmentId = selectedAssignment?.id || assignments.find(a => a.project_id === directProjectId)?.id;
    if (!assignmentId && !isDirectGuestMode) {
      toast.error("Keine Zuordnung gefunden");
      return;
    }
    setSavingId(locationId);
    try {
      if (isDirectGuestMode && guestToken) {
        await supabase.from("location_feedback").delete().eq("id", feedbackId);
      } else {
        const { data, error } = await supabase.functions.invoke("customer-data", {
          body: { action: "delete_feedback", customerId: session?.id, assignmentId, locationId, feedbackId },
        });
        if (error || data?.error) throw error || new Error(data?.error);
      }
      await reloadFeedbacks([locationId]);
      toast.success("Kommentar gelöscht");
    } catch (error) {
      console.error("deleteFeedback failed", error);
      toast.error("Fehler beim Löschen");
    } finally { setSavingId(null); }
  };

  const loadCustomerUploads = async (projectId: string) => {
    const { data } = await supabase.from("customer_uploads").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
    setCustomerUploads(data || []);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.id || !selectedAssignment) return;
    const projectId = selectedAssignment.project_id;
    setUploadingFile(true);
    try {
      const path = `customer-uploads/${projectId}/${crypto.randomUUID()}/${file.name}`;
      const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("customer_uploads").insert({
        project_id: projectId, customer_id: session.id, file_name: file.name, storage_path: path,
      });
      if (dbError) throw dbError;
      toast.success("Datei hochgeladen");
      loadCustomerUploads(projectId);
    } catch (err: any) {
      toast.error("Upload fehlgeschlagen: " + err.message);
    } finally { setUploadingFile(false); e.target.value = ""; }
  };

  const deleteUpload = async (upload: any) => {
    try {
      await supabase.storage.from("project-files").remove([upload.storage_path]);
      await supabase.from("customer_uploads").delete().eq("id", upload.id);
      toast.success("Datei gelöscht");
      loadCustomerUploads(upload.project_id);
    } catch { toast.error("Fehler beim Löschen"); }
  };

  const toggleApproval = async (locationId: string, approved: boolean) => {
    if (!selectedAssignment || selectedAssignment.direct) return;
    setApprovals(prev => ({ ...prev, [locationId]: approved }));
    await supabase.from("location_approvals").upsert({
      location_id: locationId, assignment_id: selectedAssignment.id,
      approved, approved_at: approved ? new Date().toISOString() : null,
    }, { onConflict: "location_id,assignment_id" });
    if (approved) triggerNotification("approval");
  };

  const approveAll = async (approved: boolean) => {
    if (!selectedAssignment || selectedAssignment.direct) return;
    setSavingApprovals(true);
    const newApprovals: Record<string, boolean> = {};
    locations.forEach(l => { newApprovals[l.id] = approved; });
    setApprovals(newApprovals);
    const rows = locations.map(l => ({
      location_id: l.id, assignment_id: selectedAssignment.id,
      approved, approved_at: approved ? new Date().toISOString() : null,
    }));
    await supabase.from("location_approvals").upsert(rows, { onConflict: "location_id,assignment_id" });
    if (approved) triggerNotification("approval");
    toast.success(approved ? "Alle Standorte freigegeben" : "Alle Freigaben zurückgenommen");
    setSavingApprovals(false);
  };

  const allApproved = !isDirectGuestMode && locations.length > 0 && locations.every(l => approvals[l.id]);
  const someApproved = !isDirectGuestMode && locations.some(l => approvals[l.id]);
  const handleLogout = () => { clearSession(); navigate("/"); };

  if (loading && !selectedAssignment) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Laden...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedAssignment && (
              <Button variant="ghost" size="sm" onClick={() => { setSelectedAssignment(null); setLocations([]); const next = new URLSearchParams(searchParams); next.delete("project"); setSearchParams(next); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-xl font-bold">
                {selectedAssignment ? `Projekt ${selectedAssignment.projects.project_number}` : "Meine Projekte"}
              </h1>
              <p className="text-sm text-muted-foreground">{session?.name}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}><LogOut className="h-4 w-4" /></Button>
        </div>

        {!selectedAssignment ? (
          assignments.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">Keine Projekte zugewiesen.</p>
          ) : (
            <div className="grid gap-3">
              {assignments.map((a) => (
                <Card key={a.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadLocations(a)}>
                  <CardHeader><CardTitle>Projekt {a.projects.project_number}</CardTitle></CardHeader>
                </Card>
              ))}
            </div>
          )
        ) : loading ? (
          <p className="text-center text-muted-foreground py-8">Laden...</p>
        ) : locations.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">Keine Standorte vorhanden.</p>
        ) : (
          <>
            {!isDirectGuestMode && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm">Gesamtfreigabe</p>
                      <p className="text-xs text-muted-foreground">
                        {locations.filter(l => approvals[l.id]).length} von {locations.length} Standorten freigegeben
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {someApproved && (
                        <Button size="sm" variant="outline" onClick={() => approveAll(false)} disabled={savingApprovals}>Alle zurücknehmen</Button>
                      )}
                      <Button size="sm" onClick={() => approveAll(true)} disabled={allApproved || savingApprovals}>
                        <CheckCheck className="h-4 w-4 mr-1" /> Alle freigeben
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Customer File Upload */}
            {isRealCustomerId(session?.id) && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Dateien hochladen</p>
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.svg,.ai,.eps" onChange={handleFileUpload} disabled={uploadingFile} />
                      <Button size="sm" variant="outline" asChild disabled={uploadingFile}>
                        <span><Upload className="h-4 w-4 mr-1" />{uploadingFile ? "Lädt..." : "Datei hochladen"}</span>
                      </Button>
                    </label>
                  </div>
                  {customerUploads.length > 0 && (
                    <div className="space-y-2">
                      {customerUploads.map((upload) => (
                        <div key={upload.id} className="flex items-center justify-between gap-2 p-2 rounded border bg-background">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm truncate">{upload.file_name}</span>
                          </div>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" asChild>
                              <a href={supabase.storage.from("project-files").getPublicUrl(upload.storage_path).data.publicUrl} target="_blank" rel="noopener noreferrer">
                                <Download className="h-3 w-3" />
                              </a>
                            </Button>
                            {upload.customer_id === session?.id && (
                              <Button size="sm" variant="ghost" onClick={() => deleteUpload(upload)}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              {locations.map((loc) => {
                const annotated = images.find((i: any) => i.location_id === loc.id && i.image_type === "annotated");
                const pdfEntries = images.filter((i: any) => i.location_id === loc.id && i.image_type === "pdf");
                const locationFeedback = feedbacks[loc.id] || [];
                const isApproved = !!approvals[loc.id];
                return (
                  <Card key={loc.id} className={isApproved ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : ""}>
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">
                            Standort {loc.location_number}
                            {loc.location_name && <span className="font-normal text-muted-foreground ml-2">· {loc.location_name}</span>}
                          </CardTitle>
                        </div>
                        {!isDirectGuestMode && (
                          <Button size="sm" variant={isApproved ? "outline" : "default"} onClick={() => toggleApproval(loc.id, !isApproved)}>
                            <Check className="h-4 w-4 mr-1" /> {isApproved ? "Freigabe zurücknehmen" : "Freigeben"}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      {annotated && (
                        <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                          <img src={getImageUrl(annotated.storage_path)} alt={`Standort ${loc.location_number}`} className="w-full h-full object-contain" />
                        </div>
                      )}

                      {visibleFields.length > 0 && (
                        <LocationInfoFields location={loc} fields={visibleFields} customerOnly />
                      )}

                      {pdfEntries.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Druckdaten</p>
                          {pdfEntries.map((pdf: any) => (
                            <a
                              key={pdf.id}
                              href={getImageUrl(pdf.storage_path)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-primary hover:underline"
                            >
                              <FileText className="h-4 w-4" />
                              {pdf.file_name}
                            </a>
                          ))}
                        </div>
                      )}

                      <div className="space-y-3">
                        <Label>Hinweise / Korrekturen</Label>
                        {locationFeedback.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Noch keine Rückmeldungen vorhanden.</p>
                        ) : (
                          <div className="space-y-2">
                            {locationFeedback.map((entry) => (
                              <div key={entry.id} className="rounded-lg border p-3 bg-muted/20 space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium">{entry.author_name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {entry.created_at && new Date(entry.created_at).getTime() > 0
                                        ? format(new Date(entry.created_at), "dd.MM.yyyy, HH:mm", { locale: de })
                                        : ""}
                                    </p>
                                  </div>
                                  <span className={`text-xs px-2 py-0.5 rounded ${entry.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{entry.status === "done" ? "Umgesetzt" : "Offen"}</span>
                                </div>
                                <p className="text-sm whitespace-pre-wrap">{entry.message}</p>
                                {(entry.author_customer_id === session?.id || (!entry.author_customer_id && entry.author_name === session?.name)) && entry.status === "open" && (
                                  <div className="flex gap-2">
                                    <Button variant="ghost" size="sm" className="px-0" onClick={() => startEditFeedback(loc.id, entry)}>
                                      <Pencil className="h-4 w-4 mr-1" /> Bearbeiten
                                    </Button>
                                    <Button variant="ghost" size="sm" className="px-0 text-destructive" onClick={() => deleteFeedback(loc.id, entry.id)}>
                                      <Trash2 className="h-4 w-4 mr-1" /> Löschen
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <Textarea
                          placeholder="Hinweis oder Korrektur zu diesem Standort eingeben..."
                          value={draftFeedback[loc.id] || ""}
                          onChange={(e) => setDraftFeedback((prev) => ({ ...prev, [loc.id]: e.target.value }))}
                          rows={3}
                        />
                        <Button size="sm" onClick={() => saveFeedback(loc.id)} disabled={savingId === loc.id || !(draftFeedback[loc.id] || "").trim()}>
                          <Save className="h-4 w-4 mr-1" />
                          {savingId === loc.id ? "Speichert..." : editingFeedbackId[loc.id] ? "Hinweis aktualisieren" : "Hinweis speichern"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

          </>
        )}
      </div>
    </div>
  );
};

export default CustomerView;
