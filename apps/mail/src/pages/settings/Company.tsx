import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { DEFAULT_FOLDER_NAMES, FOLDER_KEYS, type FolderNames } from "@/lib/shared";
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Spinner, Switch, Textarea } from "@/components/ui";
import { errorText } from "@/lib/utils";

interface Gewerk { short: string; name: string; measure_id: number | null; default: boolean; keywords?: string[]; services?: string[] }
interface Hero {
  project_type_id: number; start_step_id: number; steps: Record<string, number>; excluded_steps: number[];
  offer_document_type_id: number; document_types: Record<string, number>;
}
interface Config {
  folders: Partial<FolderNames> | null; gewerke: Gewerk[] | null; hero: Hero | null; company_knowledge: string | null;
  reply_rules: string | null; lexoffice: { address: string } | null; budget: { monthly_usd: number | null } | null; retention_days: number | null;
}

const STEP_LABELS: Record<string, string> = {
  angebot: "Angeboterstellung", vor_ort: "Vor-Ort-Termin", detailgespraech: "Detailgespräch", projektplanung: "Projektplanung",
  visualisierung: "Visualisierung / Layout", materialbestellung: "Materialbestellung", produktionsdaten: "Produktionsdaten", reklamation: "Reklamation",
  warten_auftrag: "Warten auf Auftrag", warten_layout: "Warten auf Layoutfreigabe", warten_ware: "Warten auf Ware / Daten",
};
const DOC_LABELS: Record<string, string> = { layouts: "Layouts / Pläne", aufmasse: "Aufmaße", druckdaten: "Druckdaten", fahrzeugdaten: "Fahrzeugdaten", allgemein: "Allgemein" };

function Section({ title, onSave, saving, children }: { title: string; onSave: () => void; saving: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {children}
        <Button onClick={onSave} disabled={saving}>Speichern</Button>
      </CardContent>
    </Card>
  );
}

const num = (v: string) => (v === "" ? 0 : Number(v));
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function Company() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config"], queryFn: () => api<Config>("get_config") });
  const [c, setC] = useState<Config | null>(null);
  useEffect(() => { if (q.data) setC(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: ({ key, value }: { key: keyof Config; value: unknown }) => api("save_config", { key, value }),
    onSuccess: () => { toast.success("Gespeichert"); qc.invalidateQueries({ queryKey: ["config"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const saveKey = (key: keyof Config) => () => save.mutate({ key, value: c?.[key] });
  const reload = useMutation({
    mutationFn: () => api<{ missing: string[] }>("hero_reload"),
    onSuccess: (r) => {
      toast.success(r.missing.length ? `Neu geladen. Nicht gefunden: ${r.missing.join(", ")}` : "Aus HERO neu geladen");
      qc.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (q.isLoading || !c) return <Spinner />;
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setC({ ...c, [k]: v });
  const folders = { ...DEFAULT_FOLDER_NAMES, ...(c.folders ?? {}) };
  const gewerke = c.gewerke ?? [];
  const hero = c.hero;

  return (
    <div className="space-y-4">
      <ErrorBox error={q.error} />

      <Section title="Firmenwissen für Antwortentwürfe" onSave={saveKey("company_knowledge")} saving={save.isPending}>
        <Textarea rows={5} value={c.company_knowledge ?? ""} onChange={(e) => set("company_knowledge", e.target.value)} />
        <p className="text-xs text-muted-foreground">Leistungen, Standort, typische Abläufe. Kommt in jeden Prompt – kurz halten.</p>
      </Section>

      <Section title="Wann gibt es einen Antwortentwurf?" onSave={saveKey("reply_rules")} saving={save.isPending}>
        <Textarea rows={5} value={c.reply_rules ?? ""} onChange={(e) => set("reply_rules", e.target.value)} />
      </Section>

      <Section title="Ordnernamen im Postfach" onSave={saveKey("folders")} saving={save.isPending}>
        <div className="grid gap-3 sm:grid-cols-2">
          {FOLDER_KEYS.map((k) => (
            <Field key={k} label={k}><Input value={folders[k]} onChange={(e) => set("folders", { ...folders, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Gilt für neu eingerichtete Postfächer („Ordner anlegen &amp; speichern“ in den Postfach-Einstellungen).</p>
      </Section>

      <Section title="Gewerke" onSave={saveKey("gewerke")} saving={save.isPending}>
        {gewerke.map((g, i) => {
          const upd = (p: Partial<Gewerk>) => set("gewerke", gewerke.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Kürzel"><Input value={g.short} onChange={(e) => upd({ short: e.target.value.toUpperCase() })} /></Field>
                <Field label="Name"><Input value={g.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                <Field label="HERO-Gewerk-ID"><Input type="number" value={g.measure_id ?? ""} onChange={(e) => upd({ measure_id: num(e.target.value) })} /></Field>
                <div className="flex items-end gap-3">
                  <Switch checked={g.default} onChange={(v) => set("gewerke", gewerke.map((x, j) => ({ ...x, default: j === i ? v : v ? false : x.default })))} label="Standard" />
                  <Button variant="ghost" size="icon" aria-label="Gewerk entfernen" onClick={() => set("gewerke", gewerke.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              {!g.default && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Leistungen, die hierher gehören" hint="Komma-getrennt, z. B. Textildruck"><Input value={(g.services ?? []).join(", ")} onChange={(e) => upd({ services: list(e.target.value) })} /></Field>
                  <Field label="Stichwörter im Mailtext" hint="Komma-getrennt, z. B. textil, hoodie"><Input value={(g.keywords ?? []).join(", ")} onChange={(e) => upd({ keywords: list(e.target.value) })} /></Field>
                </div>
              )}
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={() => set("gewerke", [...gewerke, { short: "", name: "", measure_id: null, default: false }])}><Plus className="h-3 w-3" /> Gewerk</Button>
        <p className="text-xs text-muted-foreground">Das Kürzel bestimmt auch, welche Projektnummern (z. B. WER-1234) in Mails erkannt werden.</p>
      </Section>

      {hero && (
        <Section title="HERO-IDs" onSave={saveKey("hero")} saving={save.isPending}>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => reload.mutate()} disabled={reload.isPending}>Pipeline-Schritte &amp; Dokumenttypen aus HERO neu laden</Button>
            <span className="text-xs text-muted-foreground">Ordnet per Name zu und überschreibt die Felder unten (nach dem Laden bitte kurz prüfen).</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Projekttyp (PROJEKT)"><Input type="number" value={hero.project_type_id} onChange={(e) => set("hero", { ...hero, project_type_id: num(e.target.value) })} /></Field>
            <Field label="Startschritt (📬 Anfragen)"><Input type="number" value={hero.start_step_id} onChange={(e) => set("hero", { ...hero, start_step_id: num(e.target.value) })} /></Field>
            <Field label="Dokumenttyp Angebot"><Input type="number" value={hero.offer_document_type_id} onChange={(e) => set("hero", { ...hero, offer_document_type_id: num(e.target.value) })} /></Field>
          </div>
          <h4 className="text-sm font-medium">Pipeline-Schritte für Vorschläge</h4>
          <div className="grid gap-3 sm:grid-cols-4">
            {Object.entries(STEP_LABELS).map(([k, label]) => (
              <Field key={k} label={label}><Input type="number" value={hero.steps[k] ?? ""} onChange={(e) => set("hero", { ...hero, steps: { ...hero.steps, [k]: num(e.target.value) } })} /></Field>
            ))}
          </div>
          <Field label="Schritte, die bei der Zuordnung ausgeschlossen sind" hint="Komma-getrennt (Warten auf Bezahlung, Abgeschlossen, Archiviert)">
            <Input value={hero.excluded_steps.join(", ")} onChange={(e) => set("hero", { ...hero, excluded_steps: list(e.target.value).map(Number).filter((n) => Number.isFinite(n)) })} />
          </Field>
          <h4 className="text-sm font-medium">Dokumenttypen für Anhänge</h4>
          <div className="grid gap-3 sm:grid-cols-5">
            {Object.entries(DOC_LABELS).map(([k, label]) => (
              <Field key={k} label={label}><Input type="number" value={hero.document_types[k] ?? ""} onChange={(e) => set("hero", { ...hero, document_types: { ...hero.document_types, [k]: num(e.target.value) } })} /></Field>
            ))}
          </div>
        </Section>
      )}

      <Section title="Lexware Office" onSave={saveKey("lexoffice")} saving={save.isPending}>
        <Field label="Belegadresse" hint="Hierhin sendet der Assistent Belege mit Anhang automatisch (nur hierhin, nie an Kunden). info@ muss bei Lexware als Absender hinterlegt sein. Steuerung: Autopilot „Belege an Lexware senden“.">
          <Input type="email" value={c.lexoffice?.address ?? ""} onChange={(e) => set("lexoffice", { address: e.target.value })} />
        </Field>
      </Section>

      <Section title="KI-Monatsbudget" onSave={saveKey("budget")} saving={save.isPending}>
        <Field label="Budget in US-Dollar pro Monat" hint="Ist es erreicht, laufen nur noch Regeln und Logbuch über Thread und Projektnummer weiter.">
          <Input type="number" min={0} step="1" value={c.budget?.monthly_usd ?? ""} onChange={(e) => set("budget", { monthly_usd: e.target.value === "" ? null : Number(e.target.value) })} />
        </Field>
      </Section>
    </div>
  );
}
