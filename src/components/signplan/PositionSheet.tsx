import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  SIGN_ARROWS, SIGN_POSITION_STATUSES, SIGN_STATUS_LABELS,
  SignArrowDirection, SignLabelLine, SignPlanData, SignPosition, SignPositionStatus, alive,
} from "@/types/signPlan";
import { newSignRecord, removeRecord, upsertRecord } from "@/lib/signPlanStorage";
import {
  isPositionNumberTaken, labelLinesOfPositionType, sortedDestinations,
  sortedFloors, sortedTypes, typesOfPosition,
} from "@/lib/signPlanLogic";

interface Props {
  projectId: string;
  data: SignPlanData;
  position: SignPosition | null;
  onClose: () => void;
  update: (mutator: (draft: SignPlanData) => void) => Promise<void>;
}

const FREE_TEXT = "__free__";

/**
 * Bearbeitung einer Position: Kopfdaten, zugeordnete Schildtypen mit Menge
 * und – je Schild – die Beschriftungszeilen.
 *
 * Die Beschriftung haengt bewusst am SCHILD (Position + Typ) und nicht an der
 * Position: an einer Position koennen zwei Typen mit voellig verschiedenem
 * Inhalt sitzen, etwa ein Wegweiser und ein Raumnummernschild.
 */
const PositionSheet = ({ projectId, data, position, onClose, update }: Props) => {
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  const floors = sortedFloors(data);
  const types = sortedTypes(data);
  const destinations = sortedDestinations(data);

  if (!position) return null;
  const assigned = typesOfPosition(data, position.id);

  const patchPosition = async (changes: Partial<SignPosition>) => {
    await update((draft) => {
      const target = draft.positions.find((p) => p.id === position.id);
      if (target) upsertRecord(draft, "positions", { ...target, ...changes });
    });
  };

  const commitNumber = async () => {
    if (numberDraft === null) return;
    const next = numberDraft.trim();
    setNumberDraft(null);
    if (!next) { toast.error("Die Positionsnummer darf nicht leer sein"); return; }
    if (next === position.positionNumber) return;
    if (isPositionNumberTaken(data, next, position.id)) {
      toast.error(`Die Nummer "${next}" ist im Projekt schon vergeben`);
      return;
    }
    await patchPosition({ positionNumber: next });
  };

  const addType = async (signTypeId: string) => {
    if (assigned.some((pt) => pt.signTypeId === signTypeId)) {
      toast.error("Dieser Typ haengt bereits an der Position – bitte stattdessen die Menge erhöhen.");
      return;
    }
    await update((draft) => {
      upsertRecord(draft, "positionTypes", {
        ...newSignRecord(projectId),
        positionId: position.id,
        signTypeId,
        quantity: 1,
      });
    });
  };

  const setQuantity = async (positionTypeId: string, quantity: number) => {
    if (quantity < 1) return;
    await update((draft) => {
      const target = draft.positionTypes.find((pt) => pt.id === positionTypeId);
      if (target) upsertRecord(draft, "positionTypes", { ...target, quantity });
    });
  };

  const removeType = async (positionTypeId: string) => {
    await update((draft) => {
      removeRecord(draft, "positionTypes", positionTypeId);
      // Beschriftungszeilen dieses Schildes haengen sonst ins Leere.
      for (const line of alive(draft.labelLines).filter((l) => l.positionTypeId === positionTypeId)) {
        removeRecord(draft, "labelLines", line.id);
      }
    });
  };

  const addLine = async (positionTypeId: string) => {
    const existing = labelLinesOfPositionType(data, positionTypeId);
    await update((draft) => {
      upsertRecord(draft, "labelLines", {
        ...newSignRecord(projectId),
        positionTypeId,
        sortOrder: existing.length * 10,
        destinationId: null,
        textOverride: "",
        textSecondary: "",
        arrow: "none" as SignArrowDirection,
        pictogram: "",
        isTactile: false,
        isBraille: false,
      });
    });
  };

  const patchLine = async (lineId: string, changes: Partial<SignLabelLine>) => {
    await update((draft) => {
      const target = draft.labelLines.find((l) => l.id === lineId);
      if (target) upsertRecord(draft, "labelLines", { ...target, ...changes });
    });
  };

  const removeLine = async (lineId: string) => {
    await update((draft) => removeRecord(draft, "labelLines", lineId));
  };

  const moveLine = async (positionTypeId: string, lineId: string, direction: -1 | 1) => {
    const lines = labelLinesOfPositionType(data, positionTypeId);
    const index = lines.findIndex((l) => l.id === lineId);
    const neighbour = lines[index + direction];
    if (!neighbour) return;
    await update((draft) => {
      const a = draft.labelLines.find((l) => l.id === lineId);
      const b = draft.labelLines.find((l) => l.id === neighbour.id);
      if (!a || !b) return;
      const swap = a.sortOrder;
      upsertRecord(draft, "labelLines", { ...a, sortOrder: b.sortOrder });
      upsertRecord(draft, "labelLines", { ...b, sortOrder: swap });
    });
  };

  const deletePosition = async () => {
    await update((draft) => {
      for (const pt of alive(draft.positionTypes).filter((x) => x.positionId === position.id)) {
        for (const line of alive(draft.labelLines).filter((l) => l.positionTypeId === pt.id)) {
          removeRecord(draft, "labelLines", line.id);
        }
        removeRecord(draft, "positionTypes", pt.id);
      }
      for (const marker of alive(draft.markers).filter((m) => m.positionId === position.id)) {
        removeRecord(draft, "markers", marker.id);
      }
      for (const token of alive(draft.qrTokens).filter((t) => t.positionId === position.id)) {
        removeRecord(draft, "qrTokens", token.id);
      }
      removeRecord(draft, "positions", position.id);
    });
    onClose();
  };

  const unusedTypes = types.filter((type) => !assigned.some((pt) => pt.signTypeId === type.id));

  return (
    <Dialog open={!!position} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Position {position.positionNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Positionsnummer</Label>
              <Input
                value={numberDraft ?? position.positionNumber}
                onChange={(e) => setNumberDraft(e.target.value)}
                onBlur={commitNumber}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Geschoss</Label>
              <Select
                value={position.floorId ?? ""}
                onValueChange={(value) => patchPosition({ floorId: value })}
              >
                <SelectTrigger><SelectValue placeholder="Geschoss waehlen" /></SelectTrigger>
                <SelectContent>
                  {floors.map((floor) => (
                    <SelectItem key={floor.id} value={floor.id}>{floor.code} · {floor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Bezeichnung</Label>
              <Input
                value={position.title}
                onChange={(e) => patchPosition({ title: e.target.value })}
                placeholder="z.B. Wegweiser Flur Ost"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={position.status}
                onValueChange={(value) => patchPosition({ status: value as SignPositionStatus })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SIGN_POSITION_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{SIGN_STATUS_LABELS[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={position.isAddition}
                  onCheckedChange={(checked) => patchPosition({ isAddition: checked === true })}
                />
                Nachtrag
              </label>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Notiz</Label>
              <Textarea
                rows={2}
                value={position.note}
                onChange={(e) => patchPosition({ note: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Schilder an dieser Position</h3>
              {unusedTypes.length > 0 && (
                <Select value="" onValueChange={addType}>
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue placeholder="Typ hinzufügen" />
                  </SelectTrigger>
                  <SelectContent>
                    {unusedTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.code}{type.name ? ` · ${type.name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {assigned.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Noch kein Schildtyp zugeordnet. Ohne Typ zaehlt die Position in keiner Stueckliste mit.
              </p>
            )}

            {assigned.map((link) => {
              const type = types.find((t) => t.id === link.signTypeId);
              const lines = labelLinesOfPositionType(data, link.id);
              return (
                <div key={link.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded shrink-0 border" style={{ backgroundColor: type?.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {type?.code ?? "Unbekannter Typ"}
                        {type?.name && <span className="text-muted-foreground font-normal"> · {type.name}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(link.id, link.quantity - 1)}>–</Button>
                      <span className="w-8 text-center text-sm font-medium">{link.quantity}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(link.id, link.quantity + 1)}>+</Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeType(link.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {lines.map((line, index) => (
                      <div key={line.id} className="rounded border bg-muted/30 p-2 space-y-2">
                        <div className="flex gap-2">
                          <Select
                            value={line.destinationId ?? FREE_TEXT}
                            onValueChange={(value) =>
                              patchLine(line.id, { destinationId: value === FREE_TEXT ? null : value })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={FREE_TEXT}>Freier Text</SelectItem>
                              {destinations.map((destination) => (
                                <SelectItem key={destination.id} value={destination.id}>{destination.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={line.arrow}
                            onValueChange={(value) => patchLine(line.id, { arrow: value as SignArrowDirection })}
                          >
                            <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SIGN_ARROWS.map((arrow) => (
                                <SelectItem key={arrow.value} value={arrow.value}>
                                  {arrow.glyph} {arrow.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === 0} onClick={() => moveLine(link.id, line.id, -1)}>
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === lines.length - 1} onClick={() => moveLine(link.id, line.id, 1)}>
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => removeLine(line.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            className="h-8 text-xs"
                            value={line.textOverride}
                            onChange={(e) => patchLine(line.id, { textOverride: e.target.value })}
                            placeholder={line.destinationId ? "Textüberschreibung (Ausnahme)" : "Text"}
                          />
                          <Input
                            className="h-8 text-xs"
                            value={line.textSecondary}
                            onChange={(e) => patchLine(line.id, { textSecondary: e.target.value })}
                            placeholder="Zweite Sprache"
                          />
                        </div>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox
                              checked={line.isTactile}
                              onCheckedChange={(checked) => patchLine(line.id, { isTactile: checked === true })}
                            />
                            Taktil
                          </label>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox
                              checked={line.isBraille}
                              onCheckedChange={(checked) => patchLine(line.id, { isBraille: checked === true })}
                            />
                            Braille
                          </label>
                          <Input
                            className="h-7 text-xs flex-1"
                            value={line.pictogram}
                            onChange={(e) => patchLine(line.id, { pictogram: e.target.value })}
                            placeholder="Piktogramm"
                          />
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" className="w-full h-8" onClick={() => addLine(link.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />Beschriftungszeile
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="destructive" onClick={deletePosition}>
            <Trash2 className="h-4 w-4 mr-1" />Position löschen
          </Button>
          <Button onClick={onClose}>Fertig</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PositionSheet;
