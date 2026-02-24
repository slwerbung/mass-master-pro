import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, MapPin, List, Upload } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project, FloorPlan, FloorPlanMarker } from "@/types/project";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FloorPlanView = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFloorPlanId, setActiveFloorPlanId] = useState<string>("");
  const [placingMarker, setPlacingMarker] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const loaded = await indexedDBStorage.getProject(projectId);
      if (loaded) {
        setProject(loaded);
        if (!activeFloorPlanId && loaded.floorPlans && loaded.floorPlans.length > 0) {
          setActiveFloorPlanId(loaded.floorPlans[0].id);
        }
      }
    } catch (error) {
      console.error("Error loading project:", error);
      toast.error("Fehler beim Laden");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, activeFloorPlanId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const activeFloorPlan = project?.floorPlans?.find((fp) => fp.id === activeFloorPlanId);

  const handleImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placingMarker || !activeFloorPlan || !imageContainerRef.current || !projectId) return;

    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Clamp to 0-1
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));

    // Generate a temporary marker ID - will be linked to location after creation
    const markerId = crypto.randomUUID();
    const locationId = crypto.randomUUID();

    const newMarker: FloorPlanMarker = {
      id: markerId,
      locationId,
      x: clampedX,
      y: clampedY,
    };

    const updatedMarkers = [...activeFloorPlan.markers, newMarker];
    await indexedDBStorage.updateFloorPlanMarkers(projectId, activeFloorPlan.id, updatedMarkers);

    setPlacingMarker(false);

    // Navigate to camera/editor for new location, passing the pre-generated locationId
    navigate(`/projects/${projectId}/camera?floorPlan=${activeFloorPlan.id}&locationId=${locationId}`);
  };

  const handleMarkerClick = (marker: FloorPlanMarker, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectId) return;

    // Find if location exists
    const location = project?.locations.find((l) => l.id === marker.locationId);
    if (location) {
      navigate(`/projects/${projectId}/locations/${location.id}/edit`);
    }
  };

  const getLocationNumber = (locationId: string): string => {
    const location = project?.locations.find((l) => l.id === locationId);
    if (location) {
      const parts = location.locationNumber.split("-");
      return parts[parts.length - 1] || location.locationNumber;
    }
    return "?";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

  if (!project) return null;

  const floorPlans = project.floorPlans || [];

  if (floorPlans.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
          <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}`)} size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Zurück
          </Button>
          <div className="text-center py-16">
            <MapPin className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Keine Grundrisse vorhanden</h2>
            <p className="text-muted-foreground mb-6">
              Lade eine PDF mit Grundrissen hoch, um Standorte darauf zu markieren.
            </p>
            <Button onClick={() => navigate(`/projects/${projectId}/floor-plans/upload`)}>
              <Upload className="h-4 w-4 mr-2" />
              Grundrisse hochladen
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}`)} size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Zurück</span>
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/floor-plans/upload`)}
            >
              <Plus className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Grundriss</span>
            </Button>
          </div>
        </div>

        <h1 className="text-2xl font-bold">Grundrisse – {project.projectNumber}</h1>

        {floorPlans.length > 1 && (
          <Tabs value={activeFloorPlanId} onValueChange={setActiveFloorPlanId}>
            <TabsList className="w-full flex-wrap h-auto">
              {floorPlans.map((fp) => (
                <TabsTrigger key={fp.id} value={fp.id} className="text-xs sm:text-sm">
                  {fp.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {activeFloorPlan && (
          <div className="space-y-3">
            {floorPlans.length === 1 && (
              <p className="text-sm text-muted-foreground">{activeFloorPlan.name}</p>
            )}

            <div
              ref={imageContainerRef}
              className={`relative bg-muted rounded-lg overflow-hidden border-2 ${
                placingMarker
                  ? "border-primary cursor-crosshair"
                  : "border-transparent"
              }`}
              onClick={handleImageClick}
            >
              <img
                src={activeFloorPlan.imageData}
                alt={activeFloorPlan.name}
                className="w-full h-auto"
                draggable={false}
              />

              {/* Markers */}
              {activeFloorPlan.markers.map((marker) => (
                <button
                  key={marker.id}
                  className="absolute transform -translate-x-1/2 -translate-y-full group"
                  style={{
                    left: `${marker.x * 100}%`,
                    top: `${marker.y * 100}%`,
                  }}
                  onClick={(e) => handleMarkerClick(marker, e)}
                  title={`Standort ${getLocationNumber(marker.locationId)}`}
                >
                  <div className="flex flex-col items-center">
                    <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-sm mb-0.5 whitespace-nowrap shadow-md">
                      {getLocationNumber(marker.locationId)}
                    </span>
                    <MapPin className="h-6 w-6 text-primary drop-shadow-md" fill="currentColor" />
                  </div>
                </button>
              ))}
            </div>

            {placingMarker && (
              <div className="bg-primary/10 border border-primary rounded-lg p-3 text-center text-sm">
                <p className="font-medium">Tippe auf den Grundriss, um einen Standort zu platzieren</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setPlacingMarker(false)}
                >
                  Abbrechen
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fixed Bottom Actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg p-3 md:p-4 safe-area-bottom">
        <div className="container max-w-4xl mx-auto flex gap-2 md:gap-3">
          <Button
            size="lg"
            className="flex-1 h-12 md:h-11"
            onClick={() => setPlacingMarker(true)}
            disabled={placingMarker}
          >
            <MapPin className="mr-1 md:mr-2 h-5 w-5" />
            <span className="text-sm md:text-base">Standort platzieren</span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="h-12 md:h-11 px-3 md:px-4"
          >
            <List className="mr-1 h-5 w-5" />
            <span className="hidden sm:inline text-sm md:text-base">Liste</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FloorPlanView;
