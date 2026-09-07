import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Layers, Map, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Project } from "@/types/project";
import { SignPlanData, SignBuilding, SignFloor, alive } from "@/types/signPlan";
import { newSignRecord, removeRecord, upsertRecord } from "@/lib/signPlanStorage";
import { sortedBuildings, sortedFloors } from "@/lib/signPlanLogic";

interface Props {
  project: Project;
  data: SignPlanData;
  update: (mutator: (draft: SignPlanData) => void) => Promise<void>;
}

const NO_FLOOR = "__none__";

const StructureTab = ({ project, data, update }: Props) => {
  const [newBuildingName, setNewBuildingName] = useState("");
  const [floorDrafts, setFloorDrafts] = useState<Record<string, { name: string; code: string; level: string }>>({});

  const buildings = sortedBuildings(data);
  const floors = sortedFloors(data);
  const floorPlans = project.floorPlans || [];

  const addBuilding = async () => {
    const name = newBuildingName.trim();
    if (!name) { toast.error("Bitte einen Gebaeudenamen eingeben"); return; }
    await update((draft) => {
      upsertRecord(draft, "buildings", {
        ...newSignRecord(project.id),
        name,
        sortOrder: alive(draft.buildings).length * 10,
      } as SignBuilding);
    });
    setNewBuildingName("");
  };

  const renameBuilding = async (building: SignBuilding, name: string) => {
    await update((draft) => {
      const target = draft.buildings.find((b) => b.id === building.id);
      if (target) upsertRecord(draft, "buildings", { ...target, name });
    });
  };

  const deleteBuilding = async (building: SignBuilding) => {
    const attached = alive(data.floors).filter((f) => f.buildingId === building.id);
    if (attached.length > 0) {
      toast.error(`"${building.name}" hat noch ${attached.length} Geschoss(e). Bitte zuerst diese loeschen.`);
      return;
    }
    await update((draft) => removeRecord(draft, "buildings", building.id));
  };

  const draftFor = (buildingId: string) =>
    floorDrafts[buildingId] || { name: "", code: "", level: "0" };

  const setDraft = (buildingId: string, patch: Partial<{ name: string; code: string; level: string }>) =>
    setFloorDrafts((prev) => ({ ...prev, [buildingId]: { ...draftFor(buildingId), ...patch } }));

  const addFloor = async (building: SignBuilding) => {
    const draft = draftFor(building.id);
    const name = draft.name.trim();
    if (!name) { toast.error("Bitte eine Geschossbezeichnung eingeben"); return; }
    const code = (draft.code.trim() || name.slice(0, 3)).toUpperCase();
    const level = Number.parseInt(draft.level, 10);
    await update((draftData) => {
      upsertRecord(draftData, "floors", {
        ...newSignRecord(project.id),
        buildingId: building.id,
        name,
        code,
        level: Number.isFinite(level) ? level : 0,
      } as SignFloor);
    });
    setFloorDrafts((prev) => ({ ...prev, [building.id]: { name: "", code: "", level: "0" } }));
  };

  const updateFloor = async (floor: SignFloor, patch: Partial<SignFloor>) => {
    await update((draft) => {
      const target = draft.floors.find((f) => f.id === floor.id);
      if (target) upsertRecord(draft, "floors", { ...target, ...patch });
    });
  };

  const deleteFloor = async (floor: SignFloor) => {
    const attached = alive(data.positions).filter((p) => p.floorId === floor.id);
    if (attached.length > 0) {
      toast.error(`"${floor.name}" traegt noch ${attached.length} Position(en).`);
      return;
    }
    await update((draft) => {
      removeRecord(draft, "floors", floor.id);
      // Zuordnungen von Grundrissen an dieses Geschoss zeigen ins Leere.
      for (const link of alive(draft.floorPlanLinks).filter((l) => l.floorId === floor.id)) {
        removeRecord(draft, "floorPlanLinks", link.id);
      }
    });
  };

  const assignPlan = async (floorPlanId: string, floorId: string) => {
    await update((draft) => {
      const existing = alive(draft.floorPlanLinks).find((l) => l.floorPlanId === floorPlanId);
      if (existing) removeRecord(draft, "floorPlanLinks", existing.id);
      if (floorId !== NO_FLOOR) {
        upsertRecord(draft, "floorPlanLinks", {
          ...newSignRecord(project.id),
          floorPlanId,
          floorId,
        });
      }
    });
  };

  const linkedFloorId = (floorPlanId: string) =>
    alive(data.floorPlanLinks).find((l) => l.floorPlanId === floorPlanId)?.floorId ?? NO_FLOOR;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Gebaeude und Geschosse
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newBuildingName}
              onChange={(e) => setNewBuildingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addBuilding(); }}
              placeholder="Neues Gebaeude, z.B. Haus A"
            />
            <Button onClick={addBuilding} className="shrink-0">
              <Plus className="h-4 w-4 mr-1" />Gebaeude
            </Button>
          </div>

          {buildings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Noch kein Gebaeude angelegt. Ohne Gebaeude und Geschoss bekommt eine Position keine
              sprechende Nummer.
            </p>
          )}

          {buildings.map((building) => {
            const buildingFloors = floors.filter((f) => f.buildingId === building.id);
            const draft = draftFor(building.id);
            return (
              <div key={building.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={building.name}
                    onChange={(e) => renameBuilding(building, e.target.value)}
                    className="font-medium"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive shrink-0"
                    onClick={() => deleteBuilding(building)}
                    title="Gebaeude loeschen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  {buildingFloors.map((floor) => (
                    <div key={floor.id} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-5"
                        value={floor.name}
                        onChange={(e) => updateFloor(floor, { name: e.target.value })}
                        placeholder="Geschoss"
                      />
                      <Input
                        className="col-span-3"
                        value={floor.code}
                        onChange={(e) => updateFloor(floor, { code: e.target.value.toUpperCase() })}
                        placeholder="Kuerzel"
                        title="Kuerzel fuer die Positionsnummer, z.B. EG"
                      />
                      <Input
                        className="col-span-3"
                        type="number"
                        value={floor.level}
                        onChange={(e) => updateFloor(floor, { level: Number.parseInt(e.target.value, 10) || 0 })}
                        title="Ebene: UG = -1, EG = 0, 1.OG = 1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="col-span-1 text-destructive"
                        onClick={() => deleteFloor(floor)}
                        title="Geschoss loeschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-12 gap-2 items-end border-t pt-3">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Geschoss</Label>
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft(building.id, { name: e.target.value })}
                      placeholder="Erdgeschoss"
                    />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Kuerzel</Label>
                    <Input
                      value={draft.code}
                      onChange={(e) => setDraft(building.id, { code: e.target.value.toUpperCase() })}
                      placeholder="EG"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Ebene</Label>
                    <Input
                      type="number"
                      value={draft.level}
                      onChange={(e) => setDraft(building.id, { level: e.target.value })}
                    />
                  </div>
                  <Button className="col-span-2" onClick={() => addFloor(building)}>
                    <Layers className="h-4 w-4 mr-1" />Neu
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Map className="h-4 w-4" /> Grundrisse zuordnen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {floorPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Grundrisse im Projekt. Sie werden wie bisher unter „Grundrisse“ als PDF
              hochgeladen und stehen danach hier zur Zuordnung bereit.
            </p>
          ) : (
            floorPlans.map((plan) => (
              <div key={plan.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{plan.name}</p>
                </div>
                <Select value={linkedFloorId(plan.id)} onValueChange={(value) => assignPlan(plan.id, value)}>
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue placeholder="Geschoss waehlen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FLOOR}>Nicht zugeordnet</SelectItem>
                    {floors.map((floor) => (
                      <SelectItem key={floor.id} value={floor.id}>
                        {buildings.find((b) => b.id === floor.buildingId)?.name
                          ? `${buildings.find((b) => b.id === floor.buildingId)!.name} · ${floor.name}`
                          : floor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StructureTab;
