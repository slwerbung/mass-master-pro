import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Camera, Download, MapPin, Trash2, ImagePlus, Share2, Map } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import { getSession } from "@/lib/session";
import { deleteDetailImageFromSupabase, deleteProjectFromSupabase, getProjectRemoteTimestamp, hydrateProjectFromSupabase, syncProjectToSupabase } from "@/lib/supabaseSync";
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

const ProjectDetail = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnlineOnly, setIsOnlineOnly] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [fieldConfigs, setFieldConfigs] = useState<any[]>([]);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadFieldConfigs = async () => {
      const { data } = await supabase.from("location_field_config").select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order").order("sort_order");
      setFieldConfigs(mergeWithDefaultLocationFields((data || []) as any[]));
    };
    loadFieldConfigs();

    const loadProject = async () => {
      if (!projectId) return;
      try {
        const localProject = await indexedDBStorage.getProject(projectId);
        const remoteUpdatedAt = await getProjectRemoteTimestamp(projectId);

        if (localProject && remoteUpdatedAt && remoteUpdatedAt.getTime() > localProject.updatedAt.getTime() + 1000) {
          const hydratedProject = await hydrateProjectFromSupabase(projectId);
          if (hydratedProject) {
            setProject(hydratedProject);
            setIsOnlineOnly(false);
            setConflictNotice("Es wurde eine neuere Online-Version geladen.");
            setIsLoading(false);
            return;
          }
        }

        if (localProject) {
          // Check employee access
          const currentSession = getSession();
          if (currentSession?.role === "employee" && localProject.employeeId && localProject.employeeId !== currentSession.id) {
            toast.error("Kein Zugriff auf dieses Projekt");
            navigate("/projects");
            return;
          }
          setProject(localProject);
          setIsLoading(false);
          return;
        }

        const hydratedProject = await hydrateProjectFromSupabase(projectId);
        if (!hydratedProject) {
          toast.error("Projekt nicht gefunden");
          navigate("/projects");
          return;
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
      const syncResult = await syncProjectToSupabase(projectId);
      const reloadedProject = await indexedDBStorage.getProject(projectId);
      setProject(reloadedProject || updatedProject);
      if (syncResult === 'remote-won') toast.warning("Stand wurde aktualisiert: neuere Online-Version übernommen");
      else toast.success("Standort gelöscht");
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
        const syncResult = await syncProjectToSupabase(projectId);
        const reloaded = await indexedDBStorage.getProject(projectId);
        if (reloaded) setProject(reloaded);
        if (syncResult === 'remote-won') {
          toast.warning("Stand wurde aktualisiert: neuere Online-Version übernommen");
          return;
        }
      }
      toast.success("Detailbild gelöscht");
    } catch (error) {
      console.error("Error deleting detail image:", error);
      toast.error("Fehler beim Löschen");
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild auswählen");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => navigate(`/projects/${projectId}/editor`, { state: { imageData: reader.result as string } });
    reader.onerror = () => toast.error("Fehler beim Laden des Bildes");
    reader.readAsDataURL(file);
  };

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-muted-foreground">Laden...</div></div>;
  if (!project) return null;
  const isPlanProject = project.projectType === 'aufmass_mit_plan';

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        {(isOnlineOnly || conflictNotice) && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            ⚠️ {conflictNotice || "Dieses Projekt wurde von Supabase auf dieses Gerät geladen. Die Bilder stehen jetzt lokal für Bearbeitung und Export zur Verfügung."}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => navigate("/projects")} size="sm"><ArrowLeft className="mr-1 md:mr-2 h-4 w-4" /><span className="hidden sm:inline">Zurück</span></Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" size="sm"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
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

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Projekt {project.projectNumber}</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">{project.locations.length} {project.locations.length === 1 ? "Standort" : "Standorte"}{isPlanProject && ` · ${project.floorPlans?.length || 0} Grundriss(e)`}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { const guestUrl = `${window.location.origin}/guest/${projectId}`; navigator.clipboard.writeText(guestUrl); toast.success("Gast-Link kopiert!"); }}>
            <Share2 className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Gast-Link</span>
          </Button>
        </div>

        {isPlanProject && (
          <Card className="border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors" onClick={() => navigate(`/projects/${projectId}/floor-plans`)}>
            <CardContent className="flex items-center gap-3 py-4">
              <Map className="h-8 w-8 text-primary shrink-0" />
              <div className="flex-1"><h3 className="font-semibold">Grundrisse</h3><p className="text-sm text-muted-foreground">{project.floorPlans && project.floorPlans.length > 0 ? `${project.floorPlans.length} Grundriss(e) – Tippen zum Öffnen` : "Noch keine Grundrisse – Tippen zum Hochladen"}</p></div>
              <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180" />
            </CardContent>
          </Card>
        )}

        {project.locations.length === 0 ? (
          <Card className="border-2 border-dashed"><CardContent className="flex flex-col items-center justify-center py-16 text-center"><MapPin className="h-16 w-16 text-muted-foreground mb-4" /><h3 className="text-xl font-semibold mb-2">Noch keine Standorte</h3><p className="text-muted-foreground mb-6 max-w-sm">{isPlanProject ? "Öffne die Grundrisse, um Standorte auf dem Plan zu platzieren" : "Nimm das erste Foto auf, um einen Standort zu erfassen"}</p></CardContent></Card>
        ) : (
          <div className="grid gap-4">{project.locations.map((location) => <LocationCard key={location.id} location={location} projectId={projectId!} onDelete={handleDeleteLocation} onDeleteDetailImage={handleDeleteDetailImage} fieldConfigs={fieldConfigs} />)}</div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />

      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg p-3 md:p-4 safe-area-bottom">
        <div className="container max-w-4xl mx-auto flex gap-2 md:gap-3">
          {isPlanProject ? (
            <Button size="lg" className="flex-1 h-12 md:h-11" onClick={() => navigate(`/projects/${projectId}/floor-plans`)}><Map className="mr-2 h-5 w-5" />Grundrisse</Button>
          ) : (
            <>
              <Button size="lg" className="flex-1 h-12 md:h-11" onClick={() => fileInputRef.current?.click()}><ImagePlus className="mr-1 md:mr-2 h-5 w-5" /><span className="text-sm md:text-base">Bild hochladen</span></Button>
              <Button size="lg" variant="outline" onClick={() => navigate(`/projects/${projectId}/camera`)} className="h-12 md:h-11 px-3 md:px-4"><Camera className="mr-1 h-5 w-5" /><span className="hidden sm:inline text-sm md:text-base">Kamera</span></Button>
            </>
          )}
          <Button size="lg" variant="outline" onClick={() => navigate(`/projects/${projectId}/export`)} className="h-12 md:h-11 px-3 md:px-4"><Download className="mr-1 h-5 w-5" /><span className="hidden sm:inline text-sm md:text-base">Export</span></Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetail;
