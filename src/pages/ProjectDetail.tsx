import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Camera, Download, MapPin, Trash2, ImagePlus, Share2, Map, FileText, ExternalLink, Mail, Upload, CheckCheck, AlertTriangle, Clock } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import { getSession } from "@/lib/session";
import { deleteDetailImageFromSupabase, deleteProjectFromSupabase, getProjectRemoteTimestamp, hydrateProjectFromSupabase, scheduleSyncProject } from "@/lib/supabaseSync";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import LocationCard from "@/components/LocationCard";
import { supabase } from "@/integrations/supabase/client";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { mergeWithDefaultProjectFields } from "@/lib/projectFields";
import { naturalLocationSortDesc } from "@/lib/locationSorting";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { fetchViewSettings, defaultViewSettings } from "@/lib/viewSettings";
import { readImageFileForEditor } from "@/lib/imageFile";
import { useDirectCamera } from "@/lib/useDirectCamera";
import ProjectInfoFields from "@/components/ProjectInfoFields";
import { InviteCustomerDialog } from "@/components/InviteCustomerDialog";
import { SplitPdfDialog } from "@/components/SplitPdfDialog";
import { MeetingNotesCard } from "@/components/MeetingNotesCard";
import { getHeroProjectMatchId } from "@/lib/heroSyncHelpers";

const ProjectDetail = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [isOnlineOnly, setIsOnlineOnly] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [fieldConfigs, setFieldConfigs] = useState<any[]>([]);
  const [projectFieldConfigs, setProjectFieldConfigs] = useState<any[]>([]);
  const [customerUploads, setCustomerUploads] = useState<any[]>([]);
  const [viewSettings, setViewSettings] = useState(defaultViewSettings);
  const [approvalSummary, setApprovalSummary] = useState<{ state: "approved" | "corrections" | "open"; approved: number; total: number } | null>(null);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const { cameraInput, triggerCamera } = useDirectCamera({
    onCapture: (imageData) => navigate(`/projects/${projectId}/editor`, { state: { imageData } }),
  });

  useEffect(() => {
    if (project?.projectType === "fahrzeugbeschriftung") {
      navigate(`/projects/${projectId}/vehicle`, { replace: true });
    }
  }, [project?.projectType, projectId, navigate]);

  useEffect(() => {
    const loadFieldConfigs = async () => {
      const [{ data }, { data: projectData }] = await Promise.all([
        supabase.from("location_field_config").select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order").order("sort_order"),
        supabase.from("project_field_config").select("*").eq("is_active", true).order("sort_order"),
      ]);
      setFieldConfigs(mergeWithDefaultLocationFields((data || []) as any[]));
      setProjectFieldConfigs(mergeWithDefaultProjectFields((projectData || []) as any[]));
    };
    loadFieldConfigs();
    fetchViewSettings().then(setViewSettings);

    if (projectId) {
      supabase.from("customer_uploads").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).then(({ data }) => {
        setCustomerUploads(data || []);
      });
    }

    const loadProject = async () => {
      if (!projectId) return;
      try {
        const currentSession = getSession();
        const localProject = await indexedDBStorage.getProject(projectId, currentSession);

        if (localProject) {
          if (currentSession?.role === "employee") {
            const [{ data: projRow }, { data: assignmentRows }] = await Promise.all([
              supabase.from("projects").select("employee_id").eq("id", projectId).maybeSingle(),
              (supabase as any).from("project_employee_assignments").select("employee_id").eq("project_id", projectId).eq("employee_id", currentSession.id),
            ]);
            const hasAssignment = Array.isArray(assignmentRows) && assignmentRows.length > 0;
            if (projRow?.employee_id && projRow.employee_id !== currentSession.id && !hasAssignment) {
              toast.error("Kein Zugriff auf dieses Projekt");
              navigate("/projects");
              return;
            }
          }
          setProject(localProject);
          setIsLoading(false);

          getProjectRemoteTimestamp(projectId).then(async (remoteUpdatedAt) => {
            const remoteIsNewer = remoteUpdatedAt && remoteUpdatedAt.getTime() > localProject.updatedAt.getTime() + 1000;
            if (!remoteIsNewer) return;
            await hydrateProjectFromSupabase(projectId);
            const refreshed = await indexedDBStorage.getProject(projectId, currentSession);
            if (refreshed) {
              setProject(refreshed);
              setConflictNotice("Es wurde eine neuere Online-Version geladen.");
            }
          }).catch(console.error);
          return;
        }

        const hydratedProject = await hydrateProjectFromSupabase(projectId);
        if (!hydratedProject) {
          toast.error("Projekt nicht gefunden");
          navigate("/projects");
          return;
        }

        if (currentSession?.role === "employee") {
          const [{ data: projRow }, { data: assignmentRows }] = await Promise.all([
            supabase.from("projects").select("employee_id").eq("id", projectId).maybeSingle(),
            (supabase as any).from("project_employee_assignments").select("employee_id").eq("project_id", projectId).eq("employee_id", currentSession.id),
          ]);
          const hasAssignment = Array.isArray(assignmentRows) && assignmentRows.length > 0;
          if (projRow?.employee_id && projRow.employee_id !== currentSession.id && !hasAssignment) {
            toast.error("Kein Zugriff auf dieses Projekt");
            navigate("/projects");
            return;
          }
        }

        setProject(hydratedProject);
        setIsOnlineOnly(true);
      } catch (error) {
        console.error("Error loading project:", error);
        toast.error("Fehler beim Laden des Projekts");
        navigate("/projects");
      } finally {
        setIsLoading(false);
      }
    };
    loadProject();
  }, [projectId, navigate]);

  const handleDeleteProject = async () => {
    if (!projectId) return;
    try {
      await deleteProjectFromSupabase(projectId);
      await indexedDBStorage.deleteProject(projectId);
      toast.success("Projekt gelöscht");
      navigate("/projects");
    } catch (error: any) {
      console.error("Error deleting project:", error);
      toast.error(error.message || "Fehler beim Löschen");
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    if (!project || !projectId) return;
    try {
      const updatedProject = { ...project, locations: project.locations.filter((l) => l.id !== locationId) };
      await indexedDBStorage.saveProject(updatedProject);
      const reloadedProject = await indexedDBStorage.getProject(projectId);
      scheduleSyncProject(projectId);
      setProject(reloadedProject || updatedProject);
      toast.success("Standort gelöscht");
    } catch (error) {
      console.error("Error deleting location:", error);
      toast.error("Fehler beim Löschen");
    }
  };

  const handleDeleteDetailImage = async (_locationId: string, detailImageId: string) => {
    try {
      await indexedDBStorage.deleteDetailImage(detailImageId);
      await deleteDetailImageFromSupabase(detailImageId);
      if (projectId) {
        const reloaded = await indexedDBStorage.getProject(projectId, getSession());
        scheduleSyncProject(projectId);
        if (reloaded) setProject(reloaded);
      }
      toast.success("Detailbild gelöscht");
    } catch (error) {
      console.error("Error deleting detail image:", error);
      toast.error("Fehler beim Löschen");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild auswählen");
      return;
    }
    try {
      const imageData = await readImageFileForEditor(file);
      navigate(`/projects/${projectId}/editor`, { state: { imageData } });
    } catch {
      toast.error("Fehler beim Laden des Bildes");
    }
  };

  const copyGuestLink = () => {
    const guestUrl = `${window.location.origin}/guest/${projectId}`;
    navigator.clipboard.writeText(guestUrl);
    toast.success("Gast-Link kopiert!");
  };

  const isPlanProject = project?.projectType === "aufmass_mit_plan";
  const sortedLocations = useMemo(
    () => (project ? [...project.locations].sort((a, b) => naturalLocationSortDesc(a.locationNumber, b.locationNumber)) : []),
    [project?.locations],
  );

  // Projektweiter Freigabestatus (spiegelt die Kundenansicht): "Komplett
  // freigegeben" (alle Standorte freigegeben), "Korrekturen" (mind. eine
  // offene Kundenkorrektur) oder "Offen". Standortübergreifend aus
  // location_approvals + location_feedback berechnet.
  useEffect(() => {
    if (!project || project.locations.length === 0) {
      setApprovalSummary(null);
      return;
    }
    const locationIds = project.locations.map((l) => l.id);
    let cancelled = false;
    (async () => {
      try {
        const [approvalsRes, feedbackRes] = await Promise.all([
          supabase.from("location_approvals").select("location_id").in("location_id", locationIds).eq("approved", true),
          (supabase as any).from("location_feedback").select("location_id").in("location_id", locationIds).eq("author_type", "customer").eq("status", "open"),
        ]);
        if (cancelled) return;
        const approvedSet = new Set((approvalsRes.data || []).map((r: any) => r.location_id));
        const total = locationIds.length;
        const approved = approvedSet.size;
        const openCorrections = ((feedbackRes.data as any[]) || []).length > 0;
        const state: "approved" | "corrections" | "open" =
          total > 0 && approved === total ? "approved" : openCorrections ? "corrections" : "open";
        setApprovalSummary({ state, approved, total });
      } catch {
        if (!cancelled) setApprovalSummary(null);
      }
    })();
    return () => { cancelled = true; };
  }, [project?.locations]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden…</div>
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5">
        <div className="container max-w-4xl mx-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold leading-tight truncate">
              Projekt {project.projectNumber}
            </p>
            {(project as any).customerName && (
              <p className="text-xs text-muted-foreground truncate">{(project as any).customerName}</p>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setInviteOpen(true)} title="Kunde einladen">
              <Mail className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={copyGuestLink} title="Gast-Link kopieren">
              <Share2 className="h-4 w-4" />
            </Button>
            {project.locations.length > 0 && (
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSplitOpen(true)} title="Produktionsdaten hochladen">
                <Upload className="h-4 w-4" />
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10" title="Projekt löschen">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Projekt löschen?</AlertDialogTitle>
                  <AlertDialogDescription>Diese Aktion kann nicht rückgängig gemacht werden. Alle Standorte und Aufnahmen werden gelöscht.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive">Löschen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-4 pb-28">

        {/* Online / conflict notice */}
        {(isOnlineOnly || conflictNotice) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            {conflictNotice || "Dieses Projekt wurde von Supabase auf dieses Gerät geladen."}
          </div>
        )}

        {/* Project summary */}
        <div className="pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">Projekt {project.projectNumber}</h1>
            {approvalSummary && (
              approvalSummary.state === "approved" ? (
                <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium">
                  <CheckCheck className="h-4 w-4" /> Komplett freigegeben
                </span>
              ) : approvalSummary.state === "corrections" ? (
                <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Korrekturen
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                  <Clock className="h-4 w-4" /> Offen
                  {approvalSummary.approved > 0 && (
                    <span className="text-xs opacity-80">· {approvalSummary.approved}/{approvalSummary.total} freigegeben</span>
                  )}
                </span>
              )
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-muted-foreground">
            <span>{project.locations.length} {project.locations.length === 1 ? "Standort" : "Standorte"}</span>
            {isPlanProject && <span>{project.floorPlans?.length || 0} Grundriss(e)</span>}
            <span>Erstellt {formatDateTimeSafe(project.createdAt)}</span>
          </div>
        </div>

        {/* Project info fields */}
        <Card className="shadow-sm">
          <CardContent className="p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projektinfos</p>
            <ProjectInfoFields project={project} fields={projectFieldConfigs} />
          </CardContent>
        </Card>

        {/* Gesprächsnotizen (Diktiergerät → Transkript → Protokoll → HERO) */}
        <MeetingNotesCard projectId={projectId!} projectNumber={project.projectNumber} />

        {/* Floor plans (plan projects only) */}
        {isPlanProject && (
          <Card
            className="shadow-sm border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
            onClick={() => navigate(`/projects/${projectId}/floor-plans`)}
          >
            <CardContent className="flex items-center gap-3 py-4">
              <Map className="h-8 w-8 text-primary shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold">Grundrisse</h3>
                <p className="text-sm text-muted-foreground">
                  {project.floorPlans && project.floorPlans.length > 0
                    ? `${project.floorPlans.length} Grundriss(e) – Tippen zum Öffnen`
                    : "Noch keine Grundrisse – Tippen zum Hochladen"}
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180" />
            </CardContent>
          </Card>
        )}

        {/* Customer uploads */}
        {customerUploads.length > 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Kundendateien
              </p>
              {customerUploads.map((upload: any) => (
                <div key={upload.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border bg-muted/30">
                  <span className="text-sm truncate">{upload.file_name}</span>
                  <Button size="sm" variant="outline" asChild>
                    <a
                      href="#"
                      onClick={async (e) => {
                        e.preventDefault();
                        const { data } = await supabase.storage.from("project-files").createSignedUrl(upload.storage_path, 3600);
                        if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                      }}
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" /> Öffnen
                    </a>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Locations */}
        {sortedLocations.length === 0 ? (
          <Card className="shadow-sm border-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MapPin className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <h3 className="text-lg font-semibold mb-1">Noch keine Standorte</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {isPlanProject
                  ? "Öffne die Grundrisse, um Standorte auf dem Plan zu platzieren"
                  : "Nimm das erste Foto auf, um einen Standort zu erfassen"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              Standorte ({sortedLocations.length})
            </p>
            <div className="grid gap-4">
              {sortedLocations.map((location) => (
                <LocationCard
                  key={location.id}
                  location={location}
                  projectId={projectId!}
                  onDelete={handleDeleteLocation}
                  onDeleteDetailImage={handleDeleteDetailImage}
                  fieldConfigs={fieldConfigs}
                  showPrintFiles={viewSettings.internalShowPrintFiles}
                  showDetailImages={viewSettings.internalShowDetailImages}
                  project={project}
                  projectFieldConfigs={projectFieldConfigs}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
      {cameraInput}

      {/* Fixed bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border shadow-lg p-3 safe-area-bottom">
        <div className="container max-w-4xl mx-auto flex gap-2">
          {isPlanProject ? (
            <Button size="lg" className="flex-1 h-12" onClick={() => navigate(`/projects/${projectId}/floor-plans`)}>
              <Map className="mr-2 h-4 w-4" />
              <span>Grundrisse</span>
            </Button>
          ) : (
            <>
              <Button size="lg" variant="outline" className="flex-1 h-12" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="mr-1.5 h-4 w-4 shrink-0" />
                <span className="text-sm">Hochladen</span>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="flex-1 h-12"
                onClick={() => { if (isMobile) { triggerCamera(); } else { navigate(`/projects/${projectId}/camera`); } }}
              >
                <Camera className="mr-1.5 h-4 w-4 shrink-0" />
                <span className="text-sm">Kamera</span>
              </Button>
            </>
          )}
          <Button size="lg" variant="outline" className="flex-1 h-12" onClick={() => navigate(`/projects/${projectId}/export`)}>
            <Download className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="text-sm">Export</span>
          </Button>
        </div>
      </div>

      {projectId && (
        <InviteCustomerDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          projectId={projectId}
          projectNumber={project.projectNumber}
          heroProjectId={getHeroProjectMatchId(project)}
        />
      )}

      {projectId && (
        <SplitPdfDialog
          open={splitOpen}
          onOpenChange={setSplitOpen}
          projectId={projectId}
          projectNumber={project.projectNumber}
          locations={project.locations.map((l) => ({ id: l.id, locationNumber: l.locationNumber }))}
        />
      )}
    </div>
  );
};

export default ProjectDetail;
