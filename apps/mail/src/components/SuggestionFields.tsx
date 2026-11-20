import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import type { Edits, Gewerk } from "@/lib/decide";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui";
import { HeroLink } from "@/components/HeroLink";
import { ExistingCustomerChoice, type ExistingCustomer } from "@/components/SuggestionParts";

// Die Felder der Vorschlagstypen – früher der Inhalt der Einzelkarten (LinkCard, LogCard, …), jetzt ohne Kopf und Knöpfe.
// Der Zustand liegt in der Karte (`edits`/`onChange`), damit „Ausführen“ die Werte einsammeln kann.

export interface FieldsProps { s: Suggestion; edits: Edits; onChange: (e: Edits) => void }

export function LinkFields({ s, edits, onChange }: FieldsProps) {
  return (
    <>
      {s.payload.reason && <p className="text-xs text-muted-foreground">Warum: {s.payload.reason}</p>}
      <Field label="Logbuch-Eintrag"><Textarea rows={2} value={edits.text ?? ""} onChange={(e) => onChange({ ...edits, text: e.target.value })} /></Field>
    </>
  );
}

export function LogFields({ s, edits, onChange }: FieldsProps) {
  return (
    <>
      <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>{s.payload.projectName ? ` · ${s.payload.projectName}` : ""} <HeroLink id={s.payload.projectId} label="in HERO öffnen" className="align-middle" /></p>
      <Field label="Logbuch-Eintrag"><Textarea rows={2} value={edits.text ?? ""} onChange={(e) => onChange({ ...edits, text: e.target.value })} /></Field>
    </>
  );
}

export function StepFields({ s, edits, onChange }: FieldsProps) {
  const alts = (s.payload.alternatives ?? []) as { key: string; stepId: number; label: string }[];
  return (
    <>
      <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>: {s.payload.reason}. <HeroLink id={s.payload.projectId} label="in HERO öffnen" className="align-middle" /></p>
      <Field label="Neuer Schritt">
        <Select value={edits.stepId} onChange={(e) => onChange({ ...edits, stepId: Number(e.target.value) })}>
          <option value={s.payload.toStepId}>{s.payload.toLabel}</option>
          {alts.map((a) => <option key={a.stepId} value={a.stepId}>{a.label}</option>)}
        </Select>
      </Field>
      {s.payload.hint && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Hinweis: {s.payload.hint}</p>}
    </>
  );
}

type UploadItem = { attachmentId: string; filename: string; mime: string; size: number; role: string; docKey: string; documentTypeId: number; selected: boolean };

export function UploadFields({ s, edits, onChange }: FieldsProps) {
  const items = (edits.items ?? []) as UploadItem[];
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ hero: { document_types: Record<string, number> } | null }>("get_config") });
  const types = cfg.data?.hero?.document_types ?? {};
  const labels: Record<string, string> = { layouts: "Layouts / Pläne", aufmasse: "Aufmaße", druckdaten: "Druckdaten", fahrzeugdaten: "Fahrzeugdaten", allgemein: "Allgemein" };
  const upd = (i: number, p: Partial<UploadItem>) => onChange({ ...edits, items: items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const thumbs = new Map(s.attachments.map((a) => [a.id, a.url]));
  return (
    <>
      <p className="text-sm">Ans Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b> hochladen:</p>
      {items.map((it, i) => (
        <div key={it.attachmentId} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={it.selected} onChange={(e) => upd(i, { selected: e.target.checked })} aria-label={`${it.filename} hochladen`} />
          {thumbs.get(it.attachmentId) && <img src={thumbs.get(it.attachmentId)!} alt="" className="h-10 w-10 rounded border object-cover" />}
          <span className="min-w-0 flex-1 truncate">{it.filename} <span className="text-xs text-muted-foreground">({Math.round(it.size / 1024)} KB · {it.role})</span></span>
          <Select className="w-44" aria-label="Dokumenttyp" value={it.docKey} onChange={(e) => upd(i, { docKey: e.target.value, documentTypeId: types[e.target.value] ?? it.documentTypeId })}>
            {Object.keys(labels).map((k) => <option key={k} value={k} disabled={!types[k]}>{labels[k]}</option>)}
          </Select>
        </div>
      ))}
    </>
  );
}

interface OfferPos { serviceId: number | null; serviceName: string | null; description: string; quantity: number | null; unit: string | null; note: string | null }

export function OfferFields({ s, edits, onChange }: FieldsProps) {
  const kind = edits.kind as "angebot" | "vor_ort";
  const positions = (edits.positions ?? []) as OfferPos[];
  const upd = (i: number, p: Partial<OfferPos>) => onChange({ ...edits, positions: positions.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const missing = (s.payload.missing ?? []) as string[];
  return (
    <>
      <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>: {s.payload.summary}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name={`kind-${s.id}`} checked={kind === "angebot"} onChange={() => onChange({ ...edits, kind: "angebot" })} /> Angebot vorbereiten</label>
        <label className="flex items-center gap-2"><input type="radio" name={`kind-${s.id}`} checked={kind === "vor_ort"} onChange={() => onChange({ ...edits, kind: "vor_ort" })} /> Stattdessen Vor-Ort-Termin</label>
      </div>
      {kind === "vor_ort" && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Für ein Angebot fehlen Angaben: {missing.join(", ") || "Maße"}.</p>}
      {kind === "angebot" && (
        <div className="space-y-2">
          {positions.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_6rem_6rem]">
              <div className="text-sm">{p.serviceName ? <b>{p.serviceName}</b> : <Badge variant="warn">keine Leistung zugeordnet</Badge>}<div className="text-xs text-muted-foreground">{p.description}</div></div>
              <Input type="number" min={0} step="any" aria-label="Menge" value={p.quantity ?? ""} onChange={(e) => upd(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} />
              <Input aria-label="Einheit" value={p.unit ?? ""} onChange={(e) => upd(i, { unit: e.target.value || null })} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">HERO kann Positionen nicht per Schnittstelle einfügen: die Liste kommt ins Logbuch, du übernimmst sie im Angebot und prüfst die Preise.</p>
        </div>
      )}
    </>
  );
}

/** „Kontakt + Projekt anlegen“ – inkl. „Bestehender Kunde / falscher Kunde“. */
export function ProjectFields({ s, edits, onChange, gewerke }: FieldsProps & { gewerke: Gewerk[] }) {
  const p = s.payload;
  const existing = (p.existingCustomer ?? null) as ExistingCustomer | null;
  const c = (edits.contact ?? {}) as Record<string, string>;
  const set = (k: string, v: string) => onChange({ ...edits, contact: { ...c, [k]: v } });
  const fields: [string, string][] = [
    ["salutation", "Anrede"], ["first_name", "Vorname"], ["last_name", "Nachname"], ["company", "Firma"], ["email", "E-Mail"],
    ["phone", "Telefon"], ["street", "Straße"], ["zip", "PLZ"], ["city", "Ort"],
  ];
  const fromExisting = !!existing && !!edits.useExisting;
  const images = s.attachments.filter((a) => a.url);
  return (
    <>
      {existing && <ExistingCustomerChoice customer={existing} useExisting={!!edits.useExisting} onChange={(v) => onChange({ ...edits, useExisting: v })} />}
      {!fromExisting && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, l]) => <Field key={k} label={l}><Input value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Projektname"><Input value={edits.name ?? ""} onChange={(e) => onChange({ ...edits, name: e.target.value })} /></Field>
        <Field label="Gewerk">
          <Select value={edits.gw ?? ""} onChange={(e) => onChange({ ...edits, gw: e.target.value })}>
            {gewerke.map((g) => <option key={g.short} value={g.short}>{g.short} · {g.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Notiz (erscheint im Projekt)"><Textarea rows={2} value={edits.notes ?? ""} onChange={(e) => onChange({ ...edits, notes: e.target.value })} /></Field>
      {s.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => <a key={a.id} href={a.url!} target="_blank" rel="noreferrer"><img src={a.url!} alt={a.filename} className="h-16 w-16 rounded-md border object-cover" /></a>)}
          {s.attachments.filter((a) => !a.url && !a.is_ignored).map((a) => <Badge key={a.id} variant="outline">{a.filename}</Badge>)}
        </div>
      )}
    </>
  );
}
