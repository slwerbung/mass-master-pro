import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SignPlanData, SignType, alive } from "@/types/signPlan";
import { newSignRecord, removeRecord, upsertRecord } from "@/lib/signPlanStorage";
import { sortedTypes, formatEuro } from "@/lib/signPlanLogic";

interface Props {
  projectId: string;
  data: SignPlanData;
  update: (mutator: (draft: SignPlanData) => void) => Promise<void>;
}

/** Vorschlagsfarben – bewusst gut unterscheidbar, auch auf einem hellen Plan. */
const PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#db2777", "#65a30d"];

type Draft = {
  id: string | null;
  code: string;
  name: string;
  widthMm: string;
  heightMm: string;
  material: string;
  mounting: string;
  unitPrice: string;
  descriptionNeutral: string;
  manufacturer: string;
  articleNumber: string;
  color: string;
};

const emptyDraft = (color: string): Draft => ({
  id: null, code: "", name: "", widthMm: "", heightMm: "", material: "", mounting: "",
  unitPrice: "", descriptionNeutral: "", manufacturer: "", articleNumber: "", color,
});

const toDraft = (type: SignType): Draft => ({
  id: type.id,
  code: type.code,
  name: type.name,
  widthMm: type.widthMm === null ? "" : String(type.widthMm),
  heightMm: type.heightMm === null ? "" : String(type.heightMm),
  material: type.material,
  mounting: type.mounting,
  unitPrice: type.unitPrice === null ? "" : String(type.unitPrice),
  descriptionNeutral: type.descriptionNeutral,
  manufacturer: type.manufacturer,
  articleNumber: type.articleNumber,
  color: type.color,
});

const parseNumber = (value: string): number | null => {
  const normalised = value.replace(",", ".").trim();
  if (!normalised) return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
};

const TypesTab = ({ projectId, data, update }: Props) => {
  const types = sortedTypes(data);
  const [draft, setDraft] = useState<Draft | null>(null);

  const openNew = () => setDraft(emptyDraft(PALETTE[types.length % PALETTE.length]));

  const save = async () => {
    if (!draft) return;
    const code = draft.code.trim();
    if (!code) { toast.error("Bitte ein Kuerzel vergeben"); return; }
    const duplicate = alive(data.types).some(
      (t) => t.id !== draft.id && t.code.trim().toLowerCase() === code.toLowerCase(),
    );
    if (duplicate) { toast.error(`Das Kuerzel "${code}" ist im Projekt schon vergeben`); return; }

    await update((next) => {
      const existing = draft.id ? next.types.find((t) => t.id === draft.id) : null;
      const base = existing ?? { ...newSignRecord(projectId), sortOrder: alive(next.types).length * 10 };
      upsertRecord(next, "types", {
        ...(base as SignType),
        code,
        name: draft.name.trim(),
        widthMm: parseNumber(draft.widthMm),
        heightMm: parseNumber(draft.heightMm),
        material: draft.material.trim(),
        mounting: draft.mounting.trim(),
        unitPrice: parseNumber(draft.unitPrice),
        descriptionNeutral: draft.descriptionNeutral.trim(),
        manufacturer: draft.manufacturer.trim(),
        articleNumber: draft.articleNumber.trim(),
        color: draft.color,
      } as SignType);
    });
    setDraft(null);
  };

  const remove = async (type: SignType) => {
    const used = alive(data.positionTypes).filter((pt) => pt.signTypeId === type.id).length;
    if (used > 0) {
      toast.error(`"${type.code}" ist an ${used} Position(en) zugeordnet und kann nicht geloescht werden.`);
      return;
    }
    await update((next) => removeRecord(next, "types", type.id));
  };

  /** Sortierung: Nachbarn tauschen ihre sortOrder. */
  const move = async (type: SignType, direction: -1 | 1) => {
    const index = types.findIndex((t) => t.id === type.id);
    const neighbour = types[index + direction];
    if (!neighbour) return;
    await update((next) => {
      const a = next.types.find((t) => t.id === type.id);
      const b = next.types.find((t) => t.id === neighbour.id);
      if (!a || !b) return;
      const swap = a.sortOrder;
      upsertRecord(next, "types", { ...a, sortOrder: b.sortOrder });
      upsertRecord(next, "types", { ...b, sortOrder: swap });
    });
  };

  const countFor = (typeId: string) =>
    alive(data.positionTypes)
      .filter((pt) => pt.signTypeId === typeId)
      .reduce((sum, pt) => sum + pt.quantity, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {types.length} Schildtyp(en) im Projekt
        </p>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />Typ anlegen
        </Button>
      </div>

      {types.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Noch keine Schildtypen. Ohne Typen gibt es keine Stueckliste.
        </CardContent></Card>
      )}

      {types.map((type, index) => (
        <Card key={type.id}>
          <CardContent className="p-3 flex items-start gap-3">
            <span
              className="mt-1 h-6 w-6 rounded shrink-0 border"
              style={{ backgroundColor: type.color }}
              title={`Markerfarbe ${type.color}`}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {type.code}
                {type.name && <span className="text-muted-foreground font-normal"> · {type.name}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {type.widthMm && type.heightMm ? `${type.widthMm} × ${type.heightMm} mm` : "Maße offen"}
                {type.material && ` · ${type.material}`}
                {type.mounting && ` · ${type.mounting}`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatEuro(type.unitPrice) || "kein Preis"} · {countFor(type.id)} Stück verplant
              </p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => move(type, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === types.length - 1} onClick={() => move(type, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDraft(toDraft(type))}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(type)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Schildtyp bearbeiten" : "Schildtyp anlegen"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Kuerzel *</Label>
                  <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="LS-01" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bezeichnung</Label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Deckenhaenger" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Breite (mm)</Label>
                  <Input inputMode="numeric" value={draft.widthMm} onChange={(e) => setDraft({ ...draft, widthMm: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hoehe (mm)</Label>
                  <Input inputMode="numeric" value={draft.heightMm} onChange={(e) => setDraft({ ...draft, heightMm: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Material</Label>
                  <Input value={draft.material} onChange={(e) => setDraft({ ...draft, material: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Montageart</Label>
                  <Input value={draft.mounting} onChange={(e) => setDraft({ ...draft, mounting: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Preis je Stück (€)</Label>
                  <Input inputMode="decimal" value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Markerfarbe</Label>
                  <div className="flex gap-1 flex-wrap pt-1">
                    {PALETTE.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setDraft({ ...draft, color })}
                        className={`h-7 w-7 rounded border-2 ${draft.color === color ? "border-foreground" : "border-transparent"}`}
                        style={{ backgroundColor: color }}
                        aria-label={`Farbe ${color}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Fabrikatsneutrale Beschreibung</Label>
                <Textarea
                  rows={4}
                  value={draft.descriptionNeutral}
                  onChange={(e) => setDraft({ ...draft, descriptionNeutral: e.target.value })}
                  placeholder="Text für das spätere Leistungsverzeichnis – ohne Herstellernennung."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Hersteller</Label>
                  <Input value={draft.manufacturer} onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Artikelnummer</Label>
                  <Input value={draft.articleNumber} onChange={(e) => setDraft({ ...draft, articleNumber: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Hersteller und Artikelnummer bleiben leer, solange kein Katalog angebunden ist –
                die Felder stehen bereits hier, damit ein späterer Import nichts umbauen muss.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Abbrechen</Button>
            <Button onClick={save}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TypesTab;
