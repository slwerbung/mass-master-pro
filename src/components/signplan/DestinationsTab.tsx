import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SignDestination, SignPlanData, alive } from "@/types/signPlan";
import { newSignRecord, removeRecord, upsertRecord } from "@/lib/signPlanStorage";
import { destinationUsageCount, sortedDestinations } from "@/lib/signPlanLogic";

interface Props {
  projectId: string;
  data: SignPlanData;
  update: (mutator: (draft: SignPlanData) => void) => Promise<void>;
}

/**
 * Zielverzeichnis. Jede Raumbezeichnung existiert projektweit einmal – wird
 * sie hier umbenannt, aendert sich der Text auf jedem Schild, das darauf
 * verweist. Genau deshalb verweisen die Beschriftungszeilen per ID und nicht
 * per Text auf das Ziel.
 */
const DestinationsTab = ({ projectId, data, update }: Props) => {
  const destinations = sortedDestinations(data);
  const [name, setName] = useState("");
  const [nameSecondary, setNameSecondary] = useState("");

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Bitte eine Zielbezeichnung eingeben"); return; }
    if (alive(data.destinations).some((d) => d.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`"${trimmed}" steht schon im Zielverzeichnis`);
      return;
    }
    await update((draft) => {
      upsertRecord(draft, "destinations", {
        ...newSignRecord(projectId),
        name: trimmed,
        nameSecondary: nameSecondary.trim(),
        sortOrder: alive(draft.destinations).length * 10,
      } as SignDestination);
    });
    setName("");
    setNameSecondary("");
  };

  const patch = async (destination: SignDestination, changes: Partial<SignDestination>) => {
    await update((draft) => {
      const target = draft.destinations.find((d) => d.id === destination.id);
      if (target) upsertRecord(draft, "destinations", { ...target, ...changes });
    });
  };

  const remove = async (destination: SignDestination) => {
    const used = destinationUsageCount(data, destination.id);
    if (used > 0) {
      toast.error(`"${destination.name}" wird auf ${used} Zeile(n) verwendet. Zuerst dort ersetzen.`);
      return;
    }
    await update((draft) => removeRecord(draft, "destinations", destination.id));
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Ziel</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                placeholder="Radiologie"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Zweite Sprache</Label>
              <Input
                value={nameSecondary}
                onChange={(e) => setNameSecondary(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                placeholder="Radiology"
              />
            </div>
          </div>
          <Button onClick={add} size="sm" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1" />Ziel aufnehmen
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground px-1">
        Ein Ziel hier umzubenennen wirkt sofort auf allen Schildern, die darauf verweisen.
        Weicht ein einzelnes Schild ab, wird der Text direkt an der Beschriftungszeile
        überschrieben – das ist die Ausnahme, nicht die Regel.
      </p>

      {destinations.map((destination) => {
        const usage = destinationUsageCount(data, destination.id);
        return (
          <Card key={destination.id}>
            <CardContent className="p-3 flex items-center gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  value={destination.name}
                  onChange={(e) => patch(destination, { name: e.target.value })}
                />
                <Input
                  value={destination.nameSecondary}
                  onChange={(e) => patch(destination, { nameSecondary: e.target.value })}
                  placeholder="zweite Sprache"
                />
              </div>
              <Badge variant={usage > 0 ? "secondary" : "outline"} className="shrink-0" title="Verwendungen auf Schildern">
                {usage}×
              </Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => remove(destination)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        );
      })}

      {destinations.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Noch keine Ziele erfasst.
        </CardContent></Card>
      )}
    </div>
  );
};

export default DestinationsTab;
