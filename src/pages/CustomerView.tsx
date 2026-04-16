import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogOut, Save, ArrowLeft, CheckCheck, FileText, Pencil, Check, Trash2, Upload, Download, Car, ImagePlus } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { mergeWithDefaultProjectFields } from "@/lib/projectFields";
import LocationInfoFields from "@/components/LocationInfoFields";
import ProjectInfoFields from "@/components/ProjectInfoFields";
import { naturalLocationSortDesc } from "@/lib/locationSorting";
import { fetchViewSettings, defaultViewSettings } from "@/lib/viewSettings";

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
  const [detailImagesByLocation, setDetailImagesByLocation] = useState<Record<string, any[]>>({});
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [projectFields, setProjectFields] = useState<any[]>([]);
  const [selectedProjectMeta, setSelectedProjectMeta] = useState<any>(null);
  const [feedbacks, setFeedbacks] = useState<Record<string, FeedbackItem[]>>({});
  const [draftFeedback, setDraftFeedback] = useState<Record<string, string>>({});
  const [editingFeedbackId, setEditingFeedbackId] = useState<Record<string, string | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [savingApprovals, setSavingApprovals] = useState(false);
  const [customerUploads, setCustomerUploads] = useState<any[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [viewSettings, setViewSettings] = useState(defaultViewSettings);
  const [vehicleImages, setVehicleImages] = useState<any[]>([]);
  const [vehicleLayout, setVehicleLayout] = useState<any>(null);
  const [vehicleFieldConfigs, setVehicleFieldConfigs] = useState<any[]>([]);
  const [vehicleFieldValues, setVehicleFieldValues] = useState<Record<string, string>>({});
  const [vehicleFeedbackDraft, setVehicleFeedbackDraft] = useState("");
  const [vehicleFeedbacks, setVehicleFeedbacks] = useState<any[]>([]);
  const [vehicleApproved, setVehicleApproved] = useState(false);
  const [savingVehicleFeedback, setSavingVehicleFeedback] = useState(false);
  const [savingVehicleApproval, setSavingVehicleApproval] = useState(false);
  const [uploadingVehicleImage, setUploadingVehicleImage] = useState(false);
  const [editingVehicleFields, setEditingVehicleFields] = useState(false);
  const [vehicleDraftValues, setVehicleDraftValues] = useState<Record<string, string>>({});
  const [savingVehicleFields, setSavingVehicleFields] = useState(false);
  const [vehicleDragOver, setVehicleDragOver] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "customer") { navigate("/"); return; }
    fetchViewSettings().then(setViewSettings);
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
  const visibleProjectFields = useMemo(() => mergeWithDefaultProjectFields(projectFields).filter((f) => f.is_active), [projectFields]);
  const sortedLocations = useMemo(() => [...locations].sort((a, b) => naturalLocationSortDesc(a.location_number, b.location_number)), [locations]);

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
  const isLimitedGuestMode = isDirectGuestMode && !isRealCustomerId(session?.id);

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
    if (!session?.name || !isRealCustomerId(session?.id)) return false;
    try {
      const { data, error } = await supabase.functions.invoke("ensure-customer-assignment", {
        body: { projectId, customerName: session.name },
      });
      return !error && !!data?.success;
    } catch {
      return false;
    }
  };

  const loadInitial = async () => {
    setLoading(true);
    try {
      const [{ data: fieldData }, { data: projectFieldData }, assignmentResult] = await Promise.all([
        (supabase as any).from("location_field_config").select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order").order("sort_order"),
        (supabase as any).from("project_field_config").select("*").eq("is_active", true).order("sort_order"),
        isRealCustomerId(session?.id)
          ? supabase.from("customer_project_assignments").select("id, project_id, projects(id, project_number, project_type)").eq("customer_id", session!.id)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      setFields(mergeWithDefaultLocationFields((fieldData || []) as FieldConfig[]));
      setProjectFields(mergeWithDefaultProjectFields((projectFieldData || []) as any[]));

      if (assignmentResult?.error) throw assignmentResult.error;
      let loadedAssignments = assignmentResult?.data || [];

      if (directProjectId && isRealCustomerId(session?.id) && !loadedAssignments.some((a: any) => a.project_id === directProjectId)) {
        const ensured = await ensureDirectProjectAssignment(directProjectId);
        if (ensured) {
          const refreshed = await supabase.from("customer_project_assignments").select("id, project_id, projects(id, project_number, project_type)").eq("customer_id", session!.id);
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
      direct: !isRealCustomerId(session?.id),
    });
    setLoading(true);
    try {
      const [{ data: fieldData }, { data: projectFieldData }, response] = await Promise.all([
        (supabase as any).from("location_field_config").select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order").order("sort_order"),
        (supabase as any).from("project_field_config").select("*").eq("is_active", true).order("sort_order"),
        supabase.functions.invoke("guest-data", { body: { projectId, token: guestToken } }),
      ]);

      setFields(mergeWithDefaultLocationFields((fieldData || []) as FieldConfig[]));
      setProjectFields(mergeWithDefaultProjectFields((projectFieldData || []) as any[]));
      const payload = response.data || {};
      if (response.error || payload?.error) throw response.error || new Error(payload.error || "guest-load-failed");

      // Detect project type from edge function response or direct Supabase fallback
      let detectedProjectType = payload.projectType;
      if (!detectedProjectType) {
        const { data: projRow } = await supabase.from("projects").select("project_type").eq("id", projectId).maybeSingle();
        detectedProjectType = projRow?.project_type || "aufmass";
      }

      // Handle vehicle projects
      if (detectedProjectType === "fahrzeugbeschriftung") {
        // Use data from edge function if available, otherwise load directly
        let vImages = payload.vehicleImages;
        if (!vImages) {
          const [
            { data: imgs }, { data: layouts }, { data: configs },
            { data: values }, { data: fbs },
          ] = await Promise.all([
            supabase.from("vehicle_images").select("*").eq("project_id", projectId).order("created_at"),
            supabase.from("vehicle_layouts").select("*").eq("project_id", projectId).order("uploaded_at", { ascending: false }).limit(1),
            supabase.from("vehicle_field_config").select("*").eq("is_active", true).order("sort_order"),
            supabase.from("vehicle_field_values").select("field_key, value").eq("project_id", projectId),
            supabase.from("vehicle_layout_feedback").select("*").eq("project_id", projectId).order("created_at"),
          ]);
          payload.vehicleImages = imgs || [];
          payload.vehicleLayout = layouts?.[0] || null;
          payload.vehicleFieldConfigs = configs || [];
          payload.vehicleFieldValues = values || [];
          payload.vehicleFeedbacks = fbs || [];
        }
        setSelectedProjectMeta({ project_type: "fahrzeugbeschriftung" });
        setVehicleImages(payload.vehicleImages || []);
        setVehicleLayout(payload.vehicleLayout || null);
        setVehicleFieldConfigs(payload.vehicleFieldConfigs || []);
        const vVals: Record<string, string> = {};
        (payload.vehicleFieldValues || []).forEach((v: any) => { vVals[v.field_key] = v.value || ""; });
        setVehicleFieldValues(vVals);
        setVehicleFeedbacks(payload.vehicleFeedbacks || []);
        setLoading(false);
        return;
      }

      const locs = payload.locations || [];
      const imgs = payload.images || [];
      const pdfs = payload.pdfs || [];
      const locationIds = locs.map((l: any) => l.id);
      setLocations(locs);
      const allImgs = [...(imgs || []), ...((pdfs || []).map((p: any) => ({ ...p, image_type: "pdf" })))];
      setImages(allImgs);
      // Pre-resolve signed URLs for all images
      const paths = allImgs.map((img: any) => img.storage_path).filter(Boolean);
      resolveSignedUrls(paths);
      setApprovals({});
      if (locationIds.length > 0) {
        const { data: detailRows } = await supabase
          .from("detail_images")
          .select("id, location_id, caption, annotated_path, created_at")
          .in("location_id", locationIds)
          .order("created_at", { ascending: true });
        const detailMap: Record<string, any[]> = {};
        (detailRows || []).forEach((row: any) => {
          if (!detailMap[row.location_id]) detailMap[row.location_id] = [];
          detailMap[row.location_id].push(row);
        });
        setDetailImagesByLocation(detailMap);
      } else {
        setDetailImagesByLocation({});
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
      const { data: projectMeta } = await supabase.from("projects").select("id, project_number, customer_name, custom_fields, project_type").eq("id", assignment.project_id).maybeSingle();
      setSelectedProjectMeta(projectMeta || null);

      // If vehicle project, load vehicle data instead of locations
      const projectType = projectMeta?.project_type || (assignment.projects as any)?.project_type;
      if (projectType === 'fahrzeugbeschriftung') {
        await loadVehicleData(assignment.project_id, assignment.id);
        setLoading(false);
        return;
      }

      const { data: locs, error } = await supabase
        .from("locations")
        .select("id, location_number, location_name, comment, system, label, location_type, guest_info, custom_fields, created_at")
        .eq("project_id", assignment.project_id)
        .order("created_at");
      if (error) throw error;
      const locationIds = (locs || []).map((l: any) => l.id);
      setLocations(locs || []);

      if (locationIds.length > 0) {
        const [{ data: imgs }, { data: pdfs }, { data: approvData }, feedbackResponse, { data: detailRows }] = await Promise.all([
          supabase.from("location_images").select("location_id, image_type, storage_path").in("location_id", locationIds),
          supabase.from("location_pdfs").select("id, location_id, storage_path, file_name").in("location_id", locationIds),
          supabase.from("location_approvals").select("location_id, approved").eq("assignment_id", assignment.id).in("location_id", locationIds),
          (supabase as any).from("location_feedback").select("*").in("location_id", locationIds).order("created_at"),
          supabase.from("detail_images").select("id, location_id, caption, annotated_path, created_at").in("location_id", locationIds).order("created_at", { ascending: true }),
        ]);

        const pdfEntries = (pdfs || []).map((p: any) => ({ location_id: p.location_id, image_type: "pdf", storage_path: p.storage_path, file_name: p.file_name, id: p.id }));
        setImages([...(imgs || []), ...pdfEntries]);
        const detailMap: Record<string, any[]> = {};
        (detailRows || []).forEach((row: any) => {
          if (!detailMap[row.location_id]) detailMap[row.location_id] = [];
          detailMap[row.location_id].push(row);
        });
        setDetailImagesByLocation(detailMap);
        // Pre-resolve signed URLs for detail images
        const detailPaths = (detailRows || []).flatMap((r: any) =>
          [r.annotated_path, r.original_path].filter(Boolean)
        );
        if (detailPaths.length > 0) resolveSignedUrls(detailPaths);

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
        setDetailImagesByLocation({});
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

  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({});

  const resolveSignedUrls = async (paths: string[]) => {
    const unresolved = paths.filter(p => p && !signedUrlCache[p]);
    if (unresolved.length === 0) return;
    const results = await Promise.all(
      unresolved.map(async (path) => {
        const { data } = await supabase.storage.from("project-files").createSignedUrl(path, 3600);
        return { path, url: data?.signedUrl || "" };
      })
    );
    setSignedUrlCache(prev => {
      const next = { ...prev };
      results.forEach(({ path, url }) => { if (url) next[path] = url; });
      return next;
    });
  };

  const getSignedImageUrl = (path: string): string => signedUrlCache[path] || "";

  const triggerNotification = async (changeType: "approval" | "comment") => {
    if (!selectedAssignment || isLimitedGuestMode) return;
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

      if (isLimitedGuestMode && guestToken) {
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
      if (isLimitedGuestMode && guestToken) {
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

  const loadVehicleData = async (projectId: string, assignmentId: string) => {
    try {
      const [
        { data: imgs },
        { data: layouts },
        { data: configs },
        { data: values },
        { data: fbs },
        { data: approval },
      ] = await Promise.all([
        supabase.from("vehicle_images").select("*").eq("project_id", projectId).order("created_at"),
        supabase.from("vehicle_layouts").select("*").eq("project_id", projectId).order("uploaded_at", { ascending: false }).limit(1),
        supabase.from("vehicle_field_config").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("vehicle_field_values").select("field_key, value").eq("project_id", projectId),
        supabase.from("vehicle_layout_feedback").select("*").eq("project_id", projectId).order("created_at"),
        supabase.from("vehicle_layout_approval").select("*").eq("project_id", projectId).eq("assignment_id", assignmentId).maybeSingle(),
      ]);
      setVehicleImages(imgs || []);
      setVehicleLayout(layouts && layouts.length > 0 ? layouts[0] : null);
      setVehicleFieldConfigs(configs || []);
      const vals: Record<string, string> = {};
      (values || []).forEach((v: any) => { vals[v.field_key] = v.value || ""; });
      setVehicleFieldValues(vals);
      setVehicleFeedbacks(fbs || []);
      setVehicleApproved(!!(approval as any)?.approved);
    } catch (e) {
      toast.error("Fehler beim Laden der Fahrzeugdaten");
    }
  };

  const saveVehicleFeedback = async () => {
    const message = vehicleFeedbackDraft.trim();
    if (!message || !selectedAssignment) return;
    setSavingVehicleFeedback(true);
    try {
      const { data, error } = await supabase.from("vehicle_layout_feedback").insert({
        project_id: selectedAssignment.project_id,
        message,
        author_name: session?.name || "Kunde",
        author_customer_id: isRealCustomerId(session?.id) ? session!.id : null,
      }).select().single();
      if (error) throw error;
      setVehicleFeedbacks(prev => [...prev, data]);
      setVehicleFeedbackDraft("");
      toast.success("Hinweis gespeichert");
      triggerNotification("comment");
    } catch { toast.error("Fehler beim Speichern"); }
    finally { setSavingVehicleFeedback(false); }
  };

  const toggleVehicleApproval = async () => {
    if (!selectedAssignment || isLimitedGuestMode) return;
    const newVal = !vehicleApproved;
    setSavingVehicleApproval(true);
    setVehicleApproved(newVal);
    await supabase.from("vehicle_layout_approval").upsert({
      project_id: selectedAssignment.project_id,
      assignment_id: selectedAssignment.id,
      approved: newVal,
      approved_at: newVal ? new Date().toISOString() : null,
    }, { onConflict: "project_id,assignment_id" });
    if (newVal) triggerNotification("approval");
    setSavingVehicleApproval(false);
  };

  const uploadVehicleFiles = async (files: FileList | File[]) => {
    if (!selectedAssignment) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) { toast.error("Bitte Bilddateien auswählen"); return; }
    setUploadingVehicleImage(true);
    let uploaded = 0;
    for (const file of imageFiles) {
      try {
        const path = `vehicle-images/${selectedAssignment.project_id}/${crypto.randomUUID()}`;
        const { error: upErr } = await supabase.storage.from("project-files").upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        await supabase.from("vehicle_images").insert({
          project_id: selectedAssignment.project_id,
          storage_path: path,
          uploaded_by: session?.name || "Kunde",
        });
        uploaded++;
      } catch {}
    }
    setUploadingVehicleImage(false);
    if (uploaded > 0) {
      toast.success(`${uploaded} Bild${uploaded > 1 ? "er" : ""} hochgeladen`);
      await loadVehicleData(selectedAssignment.project_id, selectedAssignment.id);
    } else {
      toast.error("Upload fehlgeschlagen");
    }
  };

  const handleVehicleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    await uploadVehicleFiles(e.target.files);
    e.target.value = "";
  };

  const handleVehicleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setVehicleDragOver(false);
    if (e.dataTransfer.files.length > 0) await uploadVehicleFiles(e.dataTransfer.files);
  };

  const saveVehicleFields = async () => {
    if (!selectedAssignment) return;
    setSavingVehicleFields(true);
    try {
      for (const config of vehicleFieldConfigs) {
        const value = vehicleDraftValues[config.field_key] || "";
        await supabase.from("vehicle_field_values").upsert(
          { project_id: selectedAssignment.project_id, field_key: config.field_key, value, updated_at: new Date().toISOString() },
          { onConflict: "project_id,field_key" }
        );
      }
      setVehicleFieldValues({ ...vehicleDraftValues });
      setEditingVehicleFields(false);
      toast.success("Informationen gespeichert");
    } catch { toast.error("Fehler beim Speichern"); }
    finally { setSavingVehicleFields(false); }
  };

  const renderVehicleFieldInput = (cfg: any, value: string, onChange: (v: string) => void) => {
    let options: string[] = [];
    try { options = cfg.field_options ? JSON.parse(cfg.field_options) : []; } catch {}
    if (cfg.field_type === "textarea") return <Textarea value={value} onChange={e => onChange(e.target.value)} rows={2} className="text-sm" />;
    if (cfg.field_type === "dropdown") return (
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
        <option value="">Bitte wählen</option>
        {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    if (cfg.field_type === "checkbox") return (
      <div className="flex items-center gap-2 h-9">
        <input type="checkbox" checked={value === "true"} onChange={e => onChange(e.target.checked ? "true" : "false")} className="h-4 w-4" />
        <span className="text-sm text-muted-foreground">Ja / Nein</span>
      </div>
    );
    return <Input value={value} onChange={e => onChange(e.target.value)} className="text-sm" />;
  };

  const getVehiclePublicUrl = (path: string) => {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    return data.publicUrl;
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
    if (!selectedAssignment || isLimitedGuestMode) return;
    setApprovals(prev => ({ ...prev, [locationId]: approved }));
    await supabase.from("location_approvals").upsert({
      location_id: locationId, assignment_id: selectedAssignment.id,
      approved, approved_at: approved ? new Date().toISOString() : null,
    }, { onConflict: "location_id,assignment_id" });
    if (approved) triggerNotification("approval");
  };

  const approveAll = async (approved: boolean) => {
    if (!selectedAssignment || isLimitedGuestMode) return;
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

  const allApproved = !isLimitedGuestMode && locations.length > 0 && locations.every(l => approvals[l.id]);
  const someApproved = !isLimitedGuestMode && locations.some(l => approvals[l.id]);
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
        ) : (selectedProjectMeta?.project_type === 'fahrzeugbeschriftung' || (selectedAssignment?.projects as any)?.project_type === 'fahrzeugbeschriftung') ? (
          // ── Vehicle project view ──
          <div className="space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Car className="h-5 w-5 text-primary" />
              <p className="font-medium">Fahrzeugbeschriftung</p>
            </div>

            {/* Vehicle Images */}
            <Card>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Fahrzeugbilder</CardTitle></CardHeader>
              <CardContent className="p-4">
                {vehicleImages.length === 0 && !isLimitedGuestMode ? (
                  <label
                    className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${vehicleDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                    onDragOver={e => { e.preventDefault(); setVehicleDragOver(true); }}
                    onDragLeave={() => setVehicleDragOver(false)}
                    onDrop={handleVehicleDrop}
                  >
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleVehicleImageUpload} />
                    <ImagePlus className="h-10 w-10 text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Bilder hierher ziehen</p>
                      <p className="text-xs text-muted-foreground mt-1">oder tippen zum Auswählen — mehrere Bilder möglich</p>
                    </div>
                    {uploadingVehicleImage && <p className="text-sm text-primary">Lädt hoch...</p>}
                  </label>
                ) : vehicleImages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Noch keine Bilder vorhanden.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {vehicleImages.map((img: any) => (
                        <div key={img.id} className="rounded-lg overflow-hidden border bg-muted">
                          <img src={getVehiclePublicUrl(img.storage_path)} alt={img.caption || "Fahrzeugbild"} className="w-full h-40 object-cover" />
                          {img.caption && <p className="text-xs text-muted-foreground p-2">{img.caption}</p>}
                        </div>
                      ))}
                    </div>
                    {!isLimitedGuestMode && (
                      <label
                        className="mt-3 flex items-center gap-2 cursor-pointer w-fit"
                        onDragOver={e => { e.preventDefault(); setVehicleDragOver(true); }}
                        onDragLeave={() => setVehicleDragOver(false)}
                        onDrop={handleVehicleDrop}
                      >
                        <input type="file" accept="image/*" multiple className="hidden" onChange={handleVehicleImageUpload} disabled={uploadingVehicleImage} />
                        <Button size="sm" variant="outline" asChild disabled={uploadingVehicleImage}>
                          <span><ImagePlus className="h-4 w-4 mr-1" />{uploadingVehicleImage ? "Lädt..." : "Weitere Bilder hinzufügen"}</span>
                        </Button>
                      </label>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Vehicle Field Values — editable by customer */}
            {vehicleFieldConfigs.length > 0 && (
              <Card>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Fahrzeuginformationen</CardTitle>
                    {!isLimitedGuestMode && !editingVehicleFields && (
                      <Button size="sm" variant="outline" onClick={() => { setVehicleDraftValues({ ...vehicleFieldValues }); setEditingVehicleFields(true); }}>
                        <Pencil className="h-3 w-3 mr-1" /> Bearbeiten
                      </Button>
                    )}
                    {editingVehicleFields && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingVehicleFields(false)}>Abbrechen</Button>
                        <Button size="sm" onClick={saveVehicleFields} disabled={savingVehicleFields}>{savingVehicleFields ? "Speichert..." : "Speichern"}</Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {vehicleFieldConfigs.map((cfg: any) => (
                    <div key={cfg.field_key} className="space-y-1">
                      <Label className="text-sm text-muted-foreground">{cfg.field_label}{cfg.is_required ? " *" : ""}</Label>
                      {editingVehicleFields ? (
                        renderVehicleFieldInput(cfg, vehicleDraftValues[cfg.field_key] || "", v => setVehicleDraftValues(prev => ({ ...prev, [cfg.field_key]: v })))
                      ) : (
                        <p className="text-sm font-medium min-h-[1.25rem]">
                          {vehicleFieldValues[cfg.field_key]
                            ? cfg.field_type === "checkbox"
                              ? vehicleFieldValues[cfg.field_key] === "true" ? "Ja" : "Nein"
                              : vehicleFieldValues[cfg.field_key]
                            : <span className="text-muted-foreground italic">–</span>}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Layout */}
            {vehicleLayout && (
              <Card>
                <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Layout / Druckdatei</CardTitle></CardHeader>
                <CardContent className="p-4 space-y-3">
                  <a href={getVehiclePublicUrl(vehicleLayout.storage_path)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <span className="text-sm font-medium flex-1">{vehicleLayout.file_name}</span>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>

                  {/* Layout approval */}
                  {!isLimitedGuestMode && (
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-primary/5">
                      <div>
                        <p className="text-sm font-medium">{vehicleApproved ? "Layout freigegeben ✓" : "Layout noch nicht freigegeben"}</p>
                        <p className="text-xs text-muted-foreground">Gib das Layout frei wenn alles passt</p>
                      </div>
                      <Button size="sm" variant={vehicleApproved ? "outline" : "default"} onClick={toggleVehicleApproval} disabled={savingVehicleApproval}>
                        <Check className="h-4 w-4 mr-1" /> {vehicleApproved ? "Freigabe zurücknehmen" : "Layout freigeben"}
                      </Button>
                    </div>
                  )}

                  {/* Feedback */}
                  <div className="space-y-2">
                    <Label>Hinweise / Korrekturen zum Layout</Label>
                    {vehicleFeedbacks.length > 0 && (
                      <div className="space-y-2">
                        {vehicleFeedbacks.map((fb: any) => (
                          <div key={fb.id} className="rounded-lg border p-3 bg-muted/20 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium">{fb.author_name}</p>
                              <span className={`text-xs px-2 py-0.5 rounded ${fb.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{fb.status === "done" ? "Umgesetzt" : "Offen"}</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{fb.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <Textarea placeholder="Hinweis oder Korrektur zum Layout eingeben..." value={vehicleFeedbackDraft} onChange={e => setVehicleFeedbackDraft(e.target.value)} rows={3} />
                    <Button size="sm" onClick={saveVehicleFeedback} disabled={savingVehicleFeedback || !vehicleFeedbackDraft.trim()}>
                      <Save className="h-4 w-4 mr-1" />{savingVehicleFeedback ? "Speichert..." : "Hinweis speichern"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : locations.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">Keine Standorte vorhanden.</p>
        ) : (
          <>
            {!isLimitedGuestMode && (
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
                              <a href="#" onClick={async (e) => { e.preventDefault(); const { data } = await supabase.storage.from("project-files").createSignedUrl(upload.storage_path, 3600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }} rel="noopener noreferrer">
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


            {selectedProjectMeta && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-sm font-medium">Projektinfos</p>
                  <ProjectInfoFields project={selectedProjectMeta} fields={visibleProjectFields} />
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              {sortedLocations.map((loc) => {
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
                          <p className="text-xs text-muted-foreground mt-1">Erstellt am {formatDateTimeSafe((loc as any).created_at ?? (loc as any).createdAt)}</p>
                        </div>
                        {!isLimitedGuestMode && (
                          <Button size="sm" variant={isApproved ? "outline" : "default"} onClick={() => toggleApproval(loc.id, !isApproved)}>
                            <Check className="h-4 w-4 mr-1" /> {isApproved ? "Freigabe zurücknehmen" : "Freigeben"}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      {annotated && (
                        <div className="bg-muted rounded-lg overflow-hidden flex items-center justify-center min-h-[180px]">
                          <img src={getSignedImageUrl(annotated.storage_path)} alt={`Standort ${loc.location_number}`} className="w-full h-auto max-h-[70vh] object-contain" />
                        </div>
                      )}

                      {visibleFields.length > 0 && (
                        <LocationInfoFields location={loc} fields={visibleFields} customerOnly project={selectedProjectMeta} projectFields={visibleProjectFields} />
                      )}

                      {viewSettings.customerShowPrintFiles && pdfEntries.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Druckdaten</p>
                          {pdfEntries.map((pdf: any) => (
                            <a
                              key={pdf.id}
                              href={getSignedImageUrl(pdf.storage_path)}
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

                      {viewSettings.customerShowDetailImages && (detailImagesByLocation[loc.id] || []).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Detailbilder</p>
                          <div className="grid grid-cols-2 gap-2">
                            {(detailImagesByLocation[loc.id] || []).map((detail: any) => (
                              <div key={detail.id} className="bg-muted rounded-lg overflow-hidden flex items-center justify-center min-h-[120px]">
                                <img src={getSignedImageUrl(detail.annotated_path)} alt={detail.caption || "Detailbild"} className="w-full h-auto max-h-[220px] object-contain" />
                              </div>
                            ))}
                          </div>
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
                                        ? formatDateTimeSafe(entry.created_at)
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
