import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { getProjectRemoteTimestamp, hydrateProjectFromSupabase } from "@/lib/supabaseSync";
import { getSession } from "@/lib/session";
import { Project } from "@/types/project";
import { alive } from "@/types/signPlan";
import { isLeitsystemEnabled } from "@/lib/featureFlags";
import { useSignPlan } from "@/hooks/useSignPlan";
import { SignPositionFilter, emptyFilter } from "@/lib/signPlanLogic";
import StructureTab from "@/components/signplan/StructureTab";
import TypesTab from "@/components/signplan/TypesTab";
import PositionsTab from "@/components/signplan/PositionsTab";
import PlanTab from "@/components/signplan/PlanTab";
import DestinationsTab from "@/components/signplan/DestinationsTab";
import BoqTab from "@/components/signplan/BoqTab";

/**
 * Leitsystem-Bereich (Prototyp).
 *
 * Haengt hinter dem Feature-Flag `mmp_ff_leitsystem` und ist nur ueber den
 * Knopf in der Projektansicht erreichbar. Bestehende Ansichten bleiben
 * unangetastet – wer den Schalter nicht gesetzt hat, sieht nichts davon.
 */
const SignPlan = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<SignPositionFilter>(emptyFilter());
  const { data, isLoading: isPlanLoading, isSyncing, update, syncNow } = useSignPlan(projectId);

  const enabled = isLeitsystemEnabled();

  useEffect(() => {
    if (!enabled) navigate(`/projects/${projectId}`, { replace: true });
  }, [enabled, projectId, navigate]);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const session = getSession();
      const local = await indexedDBStorage.getProject(projectId, session);

      // Der Abgleich mit der Cloud darf das Oeffnen nicht blockieren: vor Ort
      // ist regelmaessig kein Netz, und dann zaehlt der lokale Stand.
      let remoteUpdatedAt: Date | null = null;
      if (local) {
        try {
          remoteUpdatedAt = await getProjectRemoteTimestamp(projectId);
        } catch (error) {
          console.warn("Zeitstempel aus der Cloud nicht erreichbar – lokaler Stand wird verwendet", error);
        }
      }
      const remoteIsNewer = remoteUpdatedAt && local
        ? remoteUpdatedAt.getTime() > local.updatedAt.getTime() + 1000
        : false;
      const resolved = !local || remoteIsNewer
        ? (await hydrateProjectFromSupabase(projectId)) ?? local
        : local;
      if (!resolved) {
        toast.error("Projekt nicht gefunden");
        navigate("/projects");
        return;
      }
      setProject(resolved);
    } catch (error) {
      console.error("Projekt konnte nicht geladen werden", error);
      toast.error("Fehler beim Laden");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, navigate]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const refresh = async () => {
    await loadProject();
    try {
      await syncNow();
      toast.success("Mit der Cloud abgeglichen");
    } catch (error) {
      console.error("Leitsystem-Sync fehlgeschlagen", error);
      toast.error("Abgleich fehlgeschlagen – die lokalen Änderungen bleiben erhalten.");
    }
  };

  if (!enabled) return null;
  if (isLoading || isPlanLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden…</div>
      </div>
    );
  }
  if (!project || !projectId) return null;

  const positionCount = alive(data.positions).length;

  return (
    <div className="min-h-screen bg-muted/30 pb-10">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-4 py-2.5">
        <div className="container max-w-5xl mx-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => navigate(`/projects/${projectId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold leading-tight truncate">Leitsystem · {project.projectNumber}</p>
            <p className="text-xs text-muted-foreground truncate">
              {positionCount} Position(en) · Prototyp
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={refresh} disabled={isSyncing}>
            <RefreshCw className={`h-4 w-4 sm:mr-1 ${isSyncing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Abgleichen</span>
          </Button>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto p-3 sm:p-4">
        <Tabs defaultValue="positions">
          <TabsList className="w-full flex-wrap h-auto justify-start">
            <TabsTrigger value="positions" className="text-xs sm:text-sm">Positionen</TabsTrigger>
            <TabsTrigger value="plan" className="text-xs sm:text-sm">Plan</TabsTrigger>
            <TabsTrigger value="types" className="text-xs sm:text-sm">Typen</TabsTrigger>
            <TabsTrigger value="destinations" className="text-xs sm:text-sm">Ziele</TabsTrigger>
            <TabsTrigger value="structure" className="text-xs sm:text-sm">Struktur</TabsTrigger>
            <TabsTrigger value="boq" className="text-xs sm:text-sm">Stückliste</TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="mt-3">
            <PositionsTab
              projectId={projectId}
              data={data}
              filter={filter}
              onFilterChange={setFilter}
              update={update}
            />
          </TabsContent>

          <TabsContent value="plan" className="mt-3">
            <PlanTab
              project={project}
              data={data}
              filter={filter}
              onFilterChange={setFilter}
              update={update}
              onUploadPlans={() => navigate(`/projects/${projectId}/floor-plans/upload`)}
            />
          </TabsContent>

          <TabsContent value="types" className="mt-3">
            <TypesTab projectId={projectId} data={data} update={update} />
          </TabsContent>

          <TabsContent value="destinations" className="mt-3">
            <DestinationsTab projectId={projectId} data={data} update={update} />
          </TabsContent>

          <TabsContent value="structure" className="mt-3">
            <StructureTab project={project} data={data} update={update} />
          </TabsContent>

          <TabsContent value="boq" className="mt-3">
            <BoqTab project={project} data={data} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SignPlan;
