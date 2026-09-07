import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ListOrdered, MapPin, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  SIGN_POSITION_STATUSES, SIGN_STATUS_LABELS, SignPlanData, SignPosition,
  SignPositionStatus, alive,
} from "@/types/signPlan";
import { newSignRecord, upsertRecord } from "@/lib/signPlanStorage";
import {
  ALL, SignPositionFilter, filterPositions, nextPositionNumber, renumberPositions,
  signCountOfPosition, sortedFloors, sortedTypes, typesOfPosition,
} from "@/lib/signPlanLogic";
import FilterBar from "./FilterBar";
import PositionSheet from "./PositionSheet";

interface Props {
  projectId: string;
  data: SignPlanData;
  filter: SignPositionFilter;
  onFilterChange: (filter: SignPositionFilter) => void;
  update: (mutator: (draft: SignPlanData) => void) => Promise<void>;
}

const STATUS_VARIANT: Record<SignPositionStatus, "default" | "secondary" | "outline" | "destructive"> = {
  geplant: "outline",
  freigegeben: "secondary",
  bestellt: "secondary",
  produziert: "secondary",
  montiert: "default",
  abgenommen: "default",
  entfallen: "destructive",
};

const PositionsTab = ({ projectId, data, filter, onFilterChange, update }: Props) => {
  const [openPositionId, setOpenPositionId] = useState<string | null>(null);

  const floors = sortedFloors(data);
  const types = sortedTypes(data);
  const visible = useMemo(() => filterPositions(data, filter), [data, filter]);
  const total = alive(data.positions).length;

  const openPosition = openPositionId
    ? alive(data.positions).find((p) => p.id === openPositionId) ?? null
    : null;

  const createPosition = async () => {
    if (floors.length === 0) {
      toast.error("Bitte zuerst ein Geschoss anlegen – die Positionsnummer haengt daran.");
      return;
    }
    // Steht ein Geschossfilter, entsteht die Position dort – das ist beim
    // Erfassen vor Ort der Normalfall.
    const floorId = filter.floorId !== ALL ? filter.floorId : floors[0].id;
    const positionNumber = nextPositionNumber(data, floorId);
    const record = newSignRecord(projectId);
    await update((draft) => {
      upsertRecord(draft, "positions", {
        ...record,
        floorId,
        positionNumber,
        title: "",
        status: "geplant" as SignPositionStatus,
        isAddition: false,
        note: "",
        locationId: null,
      });
      upsertRecord(draft, "qrTokens", {
        ...newSignRecord(projectId),
        positionId: record.id,
        token: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      });
    });
    setOpenPositionId(record.id);
  };

  const setStatus = async (position: SignPosition, status: SignPositionStatus) => {
    await update((draft) => {
      const target = draft.positions.find((p) => p.id === position.id);
      if (target) upsertRecord(draft, "positions", { ...target, status });
    });
  };

  const renumber = async () => {
    const changes = renumberPositions(data);
    if (changes.length === 0) { toast.info("Die Nummerierung ist bereits lückenlos"); return; }
    await update((draft) => {
      for (const change of changes) {
        const target = draft.positions.find((p) => p.id === change.position.id);
        if (target) upsertRecord(draft, "positions", { ...target, positionNumber: change.nextNumber });
      }
    });
    toast.success(`${changes.length} Position(en) neu nummeriert`);
  };

  const floorLabel = (floorId: string | null) => {
    const floor = floors.find((f) => f.id === floorId);
    return floor ? floor.code : "–";
  };

  const typeSummary = (positionId: string) => {
    const links = typesOfPosition(data, positionId);
    if (links.length === 0) return "kein Typ";
    return links
      .map((link) => {
        const type = types.find((t) => t.id === link.signTypeId);
        return `${type?.code ?? "?"}${link.quantity > 1 ? ` ×${link.quantity}` : ""}`;
      })
      .join(", ");
  };

  const markerCount = (positionId: string) =>
    alive(data.markers).filter((m) => m.positionId === positionId).length;

  return (
    <div className="space-y-3">
      <FilterBar data={data} filter={filter} onChange={onFilterChange} />

      {/* flex-wrap: auf dem Handy (390 px) passen Zaehler und beide Knoepfe
          sonst nicht in eine Zeile und die Seite scrollt seitwaerts. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {visible.length === total ? `${total} Position(en)` : `${visible.length} von ${total} Position(en)`}
        </p>
        <div className="flex gap-2 flex-wrap">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <ListOrdered className="h-4 w-4 mr-1" />Neu nummerieren
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Alle Positionen neu nummerieren?</AlertDialogTitle>
                <AlertDialogDescription>
                  Die Nummern werden je Geschoss (von unten nach oben) und nach Anlagereihenfolge
                  neu vergeben. Schilder, die bereits produziert oder montiert sind, tragen danach
                  eine andere Nummer als im Plan – bitte nur vor der Bestellung verwenden.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={renumber}>Neu nummerieren</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" onClick={createPosition}>
            <Plus className="h-4 w-4 mr-1" />Position
          </Button>
        </div>
      </div>

      {visible.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          {total === 0 ? "Noch keine Positionen erfasst." : "Keine Position passt zum Filter."}
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {visible.map((position) => (
          <Card key={position.id} className="overflow-hidden">
            <CardContent className="p-3 flex items-center gap-3">
              <button
                className="flex-1 min-w-0 text-left"
                onClick={() => setOpenPositionId(position.id)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{position.positionNumber}</span>
                  <Badge variant="outline" className="text-[10px]">{floorLabel(position.floorId)}</Badge>
                  {position.isAddition && <Badge variant="secondary" className="text-[10px]">Nachtrag</Badge>}
                  {markerCount(position.id) > 0 && (
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-label="im Plan gesetzt" />
                  )}
                </div>
                <p className="text-sm truncate">{position.title || <span className="text-muted-foreground">ohne Bezeichnung</span>}</p>
                <p className="text-xs text-muted-foreground">
                  {typeSummary(position.id)} · {signCountOfPosition(data, position.id)} Schild(er)
                </p>
              </button>
              <Select value={position.status} onValueChange={(value) => setStatus(position, value as SignPositionStatus)}>
                <SelectTrigger className="h-8 w-32 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIGN_POSITION_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{SIGN_STATUS_LABELS[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant={STATUS_VARIANT[position.status]} className="hidden sm:inline-flex shrink-0 text-[10px]">
                {SIGN_STATUS_LABELS[position.status]}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <PositionSheet
        projectId={projectId}
        data={data}
        position={openPosition}
        onClose={() => setOpenPositionId(null)}
        update={update}
      />
    </div>
  );
};

export default PositionsTab;
