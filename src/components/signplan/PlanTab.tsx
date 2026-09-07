import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Move, Upload } from "lucide-react";
import { toast } from "sonner";
import { Project } from "@/types/project";
import { SignPlanData, SignPositionStatus, alive } from "@/types/signPlan";
import { newSignRecord, upsertRecord } from "@/lib/signPlanStorage";
import {
  SignPositionFilter, filterPositions, nextPositionNumber, primaryTypeOfPosition,
  sortedTypes,
} from "@/lib/signPlanLogic";
import FilterBar from "./FilterBar";
import PositionSheet from "./PositionSheet";

interface Props {
  project: Project;
  data: SignPlanData;
  filter: SignPositionFilter;
  onFilterChange: (filter: SignPositionFilter) => void;
  update: (mutator: (draft: SignPlanData) => void) => Promise<void>;
  onUploadPlans: () => void;
}

const DRAG_THRESHOLD_PX = 4;
const NO_TYPE = "__none__";

interface LegendEntry {
  id: string;
  code: string;
  name: string;
  color: string;
  count: number;
}

/**
 * Plan-Ansicht: Marker setzen, verschieben, nach Typ eingefaerbt, mit Legende
 * und Filter.
 *
 * Die Marker sind bewusst schlichte absolut positionierte Elemente statt
 * Canvas: bei den erwarteten 150 Markern je Plan reicht das, und Treffer-
 * flaeche, Fokus und Tastaturbedienung kommen gratis mit. Beim Ziehen wird
 * die Position direkt am DOM-Knoten gesetzt und erst beim Loslassen
 * gespeichert – sonst wuerde jede Mausbewegung die ganze Liste neu rendern.
 */
const PlanTab = ({ project, data, filter, onFilterChange, update, onUploadPlans }: Props) => {
  const floorPlans = useMemo(() => project.floorPlans || [], [project.floorPlans]);
  const [activePlanId, setActivePlanId] = useState<string>(floorPlans[0]?.id ?? "");
  const [placing, setPlacing] = useState(false);
  const [openPositionId, setOpenPositionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ markerId: string; element: HTMLElement; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (floorPlans.length > 0 && !floorPlans.some((plan) => plan.id === activePlanId)) {
      setActivePlanId(floorPlans[0].id);
    }
  }, [floorPlans, activePlanId]);

  const activePlan = floorPlans.find((plan) => plan.id === activePlanId);
  const planFloorId = alive(data.floorPlanLinks).find((link) => link.floorPlanId === activePlanId)?.floorId ?? null;

  const types = sortedTypes(data);
  const visiblePositionIds = useMemo(
    () => new Set(filterPositions(data, filter).map((position) => position.id)),
    [data, filter],
  );

  const markers = useMemo(
    () => alive(data.markers).filter((marker) => marker.floorPlanId === activePlanId && visiblePositionIds.has(marker.positionId)),
    [data.markers, activePlanId, visiblePositionIds],
  );

  const positionsById = useMemo(
    () => new Map(alive(data.positions).map((position) => [position.id, position])),
    [data.positions],
  );

  /** Legende: nur die Typen, die auf DIESEM Plan tatsaechlich vorkommen. */
  const legend = useMemo<LegendEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const marker of markers) {
      const type = primaryTypeOfPosition(data, marker.positionId);
      counts.set(type?.id ?? NO_TYPE, (counts.get(type?.id ?? NO_TYPE) ?? 0) + 1);
    }
    const entries: LegendEntry[] = types
      .filter((type) => counts.has(type.id))
      .map((type) => ({ id: type.id, code: type.code, name: type.name, color: type.color, count: counts.get(type.id)! }));
    const withoutType = counts.get(NO_TYPE);
    if (withoutType) {
      entries.push({ id: NO_TYPE, code: "ohne Typ", name: "", color: "#9ca3af", count: withoutType });
    }
    return entries;
  }, [markers, types, data]);

  const relativeFromEvent = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePlanClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!placing || !activePlan || !containerRef.current) return;
    if (!planFloorId) {
      toast.error("Dieser Grundriss ist noch keinem Geschoss zugeordnet (Reiter „Struktur“).");
      return;
    }
    const { x, y } = relativeFromEvent(event.clientX, event.clientY);
    const positionNumber = nextPositionNumber(data, planFloorId);
    const position = newSignRecord(project.id);

    await update((draft) => {
      upsertRecord(draft, "positions", {
        ...position,
        floorId: planFloorId,
        positionNumber,
        title: "",
        status: "geplant" as SignPositionStatus,
        isAddition: false,
        note: "",
        locationId: null,
      });
      upsertRecord(draft, "markers", {
        ...newSignRecord(project.id),
        floorPlanId: activePlan.id,
        positionId: position.id,
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
      });
      upsertRecord(draft, "qrTokens", {
        ...newSignRecord(project.id),
        positionId: position.id,
        token: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      });
    });

    setPlacing(false);
    setOpenPositionId(position.id);
  };

  const onMarkerPointerDown = (markerId: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    dragRef.current = { markerId, element, startX: event.clientX, startY: event.clientY, moved: false };
  };

  const onMarkerPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || !containerRef.current) return;
    const dx = Math.abs(event.clientX - drag.startX);
    const dy = Math.abs(event.clientY - drag.startY);
    if (!drag.moved && dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const { x, y } = relativeFromEvent(event.clientX, event.clientY);
    drag.element.style.left = `${x * 100}%`;
    drag.element.style.top = `${y * 100}%`;
  };

  const onMarkerPointerUp = (markerId: string, positionId: string) => async (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    try { drag.element.releasePointerCapture(event.pointerId); } catch { /* schon freigegeben */ }

    if (!drag.moved) {
      setOpenPositionId(positionId);
      return;
    }
    const { x, y } = relativeFromEvent(event.clientX, event.clientY);
    await update((draft) => {
      const target = draft.markers.find((marker) => marker.id === markerId);
      if (target) upsertRecord(draft, "markers", { ...target, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    });
  };

  const openPosition = openPositionId
    ? alive(data.positions).find((position) => position.id === openPositionId) ?? null
    : null;

  /** Kurzform der Nummer für das Marker-Fähnchen: "EG-012" wird zu "012". */
  const shortNumber = (positionNumber: string) => {
    const parts = positionNumber.split("-");
    return parts[parts.length - 1] || positionNumber;
  };

  if (floorPlans.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Noch kein Grundriss im Projekt. Grundrisse werden wie bisher als PDF hochgeladen.
          </p>
          <Button onClick={onUploadPlans}><Upload className="h-4 w-4 mr-1" />Grundrisse hochladen</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={activePlanId} onValueChange={setActivePlanId}>
          <SelectTrigger className="h-9 flex-1 min-w-[12rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {floorPlans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={placing ? "secondary" : "default"}
          className="h-9"
          onClick={() => setPlacing((value) => !value)}
        >
          <MapPin className="h-4 w-4 mr-1" />
          {placing ? "Abbrechen" : "Position setzen"}
        </Button>
      </div>

      <FilterBar data={data} filter={filter} onChange={onFilterChange} showSearch={false} />

      {placing && (
        <div className="rounded-lg border border-primary bg-primary/10 p-2 text-center text-sm">
          Auf den Plan tippen – dort entsteht eine neue Position mit der nächsten freien Nummer.
        </div>
      )}

      <div
        ref={containerRef}
        className={`relative rounded-lg overflow-hidden border-2 bg-muted select-none ${placing ? "border-primary cursor-crosshair" : "border-transparent"}`}
        onClick={handlePlanClick}
      >
        {activePlan?.imageData
          ? <img src={activePlan.imageData} alt={activePlan.name} className="w-full h-auto" draggable={false} />
          : <div className="aspect-[4/3] flex items-center justify-center text-sm text-muted-foreground">Planbild nicht geladen</div>}

        {markers.map((marker) => {
          const position = positionsById.get(marker.positionId);
          const type = primaryTypeOfPosition(data, marker.positionId);
          const color = type?.color ?? "#9ca3af";
          return (
            <button
              key={marker.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 touch-none focus:outline-none focus:ring-2 focus:ring-ring rounded-full"
              style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
              onPointerDown={onMarkerPointerDown(marker.id)}
              onPointerMove={onMarkerPointerMove}
              onPointerUp={onMarkerPointerUp(marker.id, marker.positionId)}
              onClick={(event) => event.stopPropagation()}
              title={`${position?.positionNumber ?? "?"}${position?.title ? ` – ${position.title}` : ""}`}
            >
              <span
                className="flex items-center justify-center h-6 w-6 rounded-full border-2 border-white text-[9px] font-bold text-white shadow-md"
                style={{ backgroundColor: color }}
              >
                {position ? shortNumber(position.positionNumber) : "?"}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Legende</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Move className="h-3 w-3" />Marker ziehen zum Verschieben
            </p>
          </div>
          {legend.length === 0 ? (
            <p className="text-sm text-muted-foreground">Auf diesem Plan ist keine Position sichtbar.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {legend.map((entry) => (
                <span key={entry.id} className="flex items-center gap-1.5 text-xs">
                  <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: entry.color }} />
                  {entry.code}{entry.name ? ` · ${entry.name}` : ""} <span className="text-muted-foreground">({entry.count})</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PositionSheet
        projectId={project.id}
        data={data}
        position={openPosition}
        onClose={() => setOpenPositionId(null)}
        update={update}
      />
    </div>
  );
};

export default PlanTab;
