import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ProjectSearch } from "@/components/ProjectSearch";
import { ConfirmationCard, SendDocumentCard } from "@/components/OrderCards";
import { Buttons, quoted, SuggestionCard, useDecide } from "@/components/SuggestionParts";
import { formatDateTime } from "@/lib/utils";

interface Gewerk { short: string; name: string; measure_id: number | null }

function LinkCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const cands = (s.payload.candidates ?? []) as { id: number; nr: string; name: string; stepName: string | null }[];
  const [projectId, setProjectId] = useState<number | null>(s.payload.projectId ?? null);
  const [text, setText] = useState<string>(s.payload.text ?? "");
  const [showSearch, setShowSearch] = useState(false);
  const chosen = cands.find((c) => c.id === projectId);
  return (
    <SuggestionCard
      s={s} brief={chosen ? `${chosen.nr} ${chosen.name || ""}` : projectId ? (s.payload.projectNr ?? `#${projectId}`) : `${cands.length} Projekte zur Auswahl`}
      actions={<Buttons s={s} busy={decide.isPending} disabled={!projectId} acceptLabel={projectId ? `Zu ${chosen?.nr ?? s.payload.projectNr ?? `#${projectId}`} zuordnen und ins Logbuch schreiben` : "Erst ein Projekt wählen"} onAccept={() => decide.mutate({ decision: "accept", edits: { projectId, text } })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}
    >
        {s.payload.reason && <p className="text-xs text-muted-foreground">Warum: {s.payload.reason}</p>}
        <div className="space-y-1">
          {cands.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent">
              <input type="radio" name={s.id} checked={projectId === c.id} onChange={() => setProjectId(c.id)} />
              <b>{c.nr}</b> {c.name || "(ohne Name)"} <span className="text-xs text-muted-foreground">· {c.stepName ?? "?"}</span>
              {s.payload.projectId === c.id && <Badge variant="good" className="ml-auto">Vorschlag</Badge>}
            </label>
          ))}
          {!cands.length && projectId && <p className="text-sm">Projekt-ID {projectId}{s.payload.projectNr ? ` (${s.payload.projectNr})` : ""}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowSearch(!showSearch)}>{showSearch ? "Suche ausblenden" : "Anderes Projekt suchen"}</Button>
        {showSearch && <ProjectSearch selectedId={projectId} onPick={(p) => { setProjectId(p.id); toast(`Gewählt: ${p.nr}`); }} />}
        <Field label="Logbuch-Eintrag"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </SuggestionCard>
  );
}

function LogCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const [text, setText] = useState<string>(s.payload.text ?? "");
  return (
    <SuggestionCard
      s={s} brief={`${s.payload.projectNr ?? s.payload.projectId}${s.payload.projectName ? ` ${s.payload.projectName}` : ""}`}
      actions={<Buttons s={s} busy={decide.isPending} acceptLabel={`Ins Logbuch von ${s.payload.projectNr ?? `#${s.payload.projectId}`} schreiben`} onAccept={() => decide.mutate({ decision: "accept", edits: { text } })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}
    >
        <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>{s.payload.projectName ? ` · ${s.payload.projectName}` : ""}</p>
        <Field label="Logbuch-Eintrag"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </SuggestionCard>
  );
}

function StepCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const alts = (s.payload.alternatives ?? []) as { key: string; stepId: number; label: string }[];
  const [stepId, setStepId] = useState<number>(s.payload.toStepId);
  const label = stepId === s.payload.toStepId ? s.payload.toLabel : alts.find((a) => a.stepId === stepId)?.label;
  return (
    <SuggestionCard
      s={s} brief={`${s.payload.projectNr ?? s.payload.projectId} → ${label ?? "?"}`}
      actions={<Buttons s={s} busy={decide.isPending} acceptLabel={`${s.payload.projectNr ?? `#${s.payload.projectId}`}: Status auf ${quoted(label)} setzen`} onAccept={() => decide.mutate({ decision: "accept", edits: { toStepId: stepId } })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}
    >
        <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>: {s.payload.reason}.</p>
        <Field label="Neuer Schritt">
          <Select value={stepId} onChange={(e) => setStepId(Number(e.target.value))}>
            <option value={s.payload.toStepId}>{s.payload.toLabel}</option>
            {alts.map((a) => <option key={a.stepId} value={a.stepId}>{a.label}</option>)}
          </Select>
        </Field>
        {s.payload.hint && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Hinweis: {s.payload.hint}</p>}
    </SuggestionCard>
  );
}

function UploadCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const [items, setItems] = useState<{ attachmentId: string; filename: string; mime: string; size: number; role: string; docKey: string; documentTypeId: number; selected: boolean }[]>(s.payload.items ?? []);
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ hero: { document_types: Record<string, number> } | null }>("get_config") });
  const types = cfg.data?.hero?.document_types ?? {};
  const labels: Record<string, string> = { layouts: "Layouts / Pläne", aufmasse: "Aufmaße", druckdaten: "Druckdaten", fahrzeugdaten: "Fahrzeugdaten", allgemein: "Allgemein" };
  const upd = (i: number, p: Partial<(typeof items)[number]>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const thumbs = new Map(s.attachments.map((a) => [a.id, a.url]));
  const n = items.filter((i) => i.selected).length;
  return (
    <SuggestionCard
      s={s} brief={`${n} von ${items.length} Anhang/Anhänge → ${s.payload.projectNr ?? s.payload.projectId}`}
      actions={<Buttons s={s} busy={decide.isPending} disabled={!n} acceptLabel={`${n} ${n === 1 ? "Anhang" : "Anhänge"} an ${s.payload.projectNr ?? `#${s.payload.projectId}`} hochladen`} onAccept={() => decide.mutate({ decision: "accept", edits: { items } })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}
    >
        <p className="text-sm">Ans Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b> hochladen:</p>
        {items.map((it, i) => (
          <div key={it.attachmentId} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
            <input type="checkbox" checked={it.selected} onChange={(e) => upd(i, { selected: e.target.checked })} aria-label={`${it.filename} hochladen`} />
            {thumbs.get(it.attachmentId) && <img src={thumbs.get(it.attachmentId)!} alt="" className="h-10 w-10 rounded border object-cover" />}
            <span className="min-w-0 flex-1 truncate">{it.filename} <span className="text-xs text-muted-foreground">({Math.round(it.size / 1024)} KB · {it.role})</span></span>
            <Select className="w-44" value={it.docKey} onChange={(e) => upd(i, { docKey: e.target.value, documentTypeId: types[e.target.value] ?? it.documentTypeId })}>
              {Object.keys(labels).map((k) => <option key={k} value={k} disabled={!types[k]}>{labels[k]}</option>)}
            </Select>
          </div>
        ))}
    </SuggestionCard>
  );
}

interface OfferPos { serviceId: number | null; serviceName: string | null; description: string; quantity: number | null; unit: string | null; note: string | null }

function OfferCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const [kind, setKind] = useState<"angebot" | "vor_ort">(s.payload.kind);
  const [positions, setPositions] = useState<OfferPos[]>(s.payload.positions ?? []);
  const upd = (i: number, p: Partial<OfferPos>) => setPositions(positions.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const missing = (s.payload.missing ?? []) as string[];
  return (
    <SuggestionCard
      s={s} brief={kind === "angebot" ? `Angebot mit ${positions.length} Position(en)` : "Vor-Ort-Termin"}
      actions={<Buttons s={s} busy={decide.isPending} acceptLabel={kind === "angebot" ? `Angebotsentwurf in ${s.payload.projectNr ?? `#${s.payload.projectId}`} anlegen` : `${s.payload.projectNr ?? `#${s.payload.projectId}`}: Status auf „Vor-Ort-Termin“ setzen`} onAccept={() => decide.mutate({ decision: "accept", edits: { kind, positions } })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}
    >
        <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>: {s.payload.summary}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={kind === "angebot"} onChange={() => setKind("angebot")} /> Angebot vorbereiten</label>
          <label className="flex items-center gap-2"><input type="radio" checked={kind === "vor_ort"} onChange={() => setKind("vor_ort")} /> Stattdessen Vor-Ort-Termin</label>
        </div>
        {kind === "vor_ort" && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Für ein Angebot fehlen Angaben: {missing.join(", ") || "Maße"}.</p>}
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
    </SuggestionCard>
  );
}

function ProjectCard({ s, gewerke }: { s: Suggestion; gewerke: Gewerk[] }) {
  const decide = useDecide(s);
  const p = s.payload;
  const [c, setC] = useState({ ...p.contact });
  const [name, setName] = useState<string>(p.project?.name ?? "");
  const [notes, setNotes] = useState<string>(p.project?.notes ?? "");
  const [gw, setGw] = useState<string>(p.project?.gewerk?.short ?? "");
  const set = (k: string, v: string) => setC({ ...c, [k]: v });
  const fields: [string, string][] = [
    ["salutation", "Anrede"], ["first_name", "Vorname"], ["last_name", "Nachname"], ["company", "Firma"], ["email", "E-Mail"],
    ["phone", "Telefon"], ["street", "Straße"], ["zip", "PLZ"], ["city", "Ort"],
  ];
  const images = s.attachments.filter((a) => a.url);
  const who = c.company || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email;
  return (
    <SuggestionCard
      s={s} brief={`${name || "(ohne Projektname)"}${who ? ` · ${who}` : ""}`}
      actions={
        <Buttons
          s={s} busy={decide.isPending} acceptLabel={`Neues Projekt ${quoted(name)}${who ? ` für ${who}` : ""} in HERO anlegen`}
          onAccept={() => decide.mutate({ decision: "accept", edits: { contact: c, project: { name, notes, gewerk: gewerke.find((g) => g.short === gw) ?? null } } })}
          onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })}
        />
      }
    >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, l]) => <Field key={k} label={l}><Input value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Projektname"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Gewerk">
            <Select value={gw} onChange={(e) => setGw(e.target.value)}>
              {gewerke.map((g) => <option key={g.short} value={g.short}>{g.short} · {g.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notiz (erscheint im Projekt)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {s.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((a) => <a key={a.id} href={a.url!} target="_blank" rel="noreferrer"><img src={a.url!} alt={a.filename} className="h-16 w-16 rounded-md border object-cover" /></a>)}
            {s.attachments.filter((a) => !a.url && !a.is_ignored).map((a) => <Badge key={a.id} variant="outline">{a.filename}</Badge>)}
          </div>
        )}
    </SuggestionCard>
  );
}

interface Digest { text: string; openSuggestions: number; portalOpen: { id: string; subject: string; from: string; sent_at: string | null }[]; unanswered: { id: string; subject: string; from: string; sent_at: string | null }[]; claims: { id: string; subject: string; from: string; sent_at: string | null }[] }

function DigestCard() {
  const q = useQuery({ queryKey: ["digest"], queryFn: () => api<Digest>("digest"), refetchInterval: 300_000 });
  const d = q.data;
  if (!d || (!d.unanswered.length && !d.claims.length && !d.portalOpen.length)) return null;
  const list = (title: string, rows: Digest["claims"], tone: "danger" | "warn") => rows.length > 0 && (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium"><Badge variant={tone}>{rows.length}</Badge> {title}</div>
      {rows.slice(0, 5).map((r) => (
        <Link key={r.id} to={`/mails/${r.id}`} className="block truncate text-sm hover:underline">
          {r.from} – {r.subject || "(ohne Betreff)"} <span className="text-xs text-muted-foreground">({formatDateTime(r.sent_at)})</span>
        </Link>
      ))}
    </div>
  );
  return (
    <Card>
      <CardHeader><CardTitle>Übersicht</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {list("Rechnungen im Portal abzuholen", d.portalOpen, "warn")}
        {list("Offene Reklamationen", d.claims, "danger")}
        {list("Kundenmails seit über 2 Tagen unbeantwortet", d.unanswered, "warn")}
      </CardContent>
    </Card>
  );
}

export default function Decide() {
  const q = useQuery({ queryKey: ["suggestions"], queryFn: () => api<Suggestion[]>("list_suggestions", { status: "offen" }), refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ gewerke: Gewerk[] | null }>("get_config") });
  const gewerke = cfg.data?.gewerke ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Zu entscheiden</h1>
        {q.isFetching && <Spinner />}
      </div>
      <ErrorBox error={q.error} />
      <DigestCard />
      {q.data && !q.data.length && <Card><CardContent className="p-6 text-sm text-muted-foreground">Keine offenen Vorschläge. 🎉</CardContent></Card>}
      <div className="space-y-4">
        {q.data?.map((s) => {
          switch (s.type) {
            case "link_project": return <LinkCard key={s.id} s={s} />;
            case "log_entry": return <LogCard key={s.id} s={s} />;
            case "change_step": return <StepCard key={s.id} s={s} />;
            case "create_project": return <ProjectCard key={s.id} s={s} gewerke={gewerke} />;
            case "upload_attachments": return <UploadCard key={s.id} s={s} />;
            case "prepare_offer": return <OfferCard key={s.id} s={s} />;
            case "create_confirmation": return <ConfirmationCard key={s.id} s={s} />;
            case "send_document": return <SendDocumentCard key={s.id} s={s} />;
            default: return <GenericCard key={s.id} s={s} />;
          }
        })}
      </div>
    </div>
  );
}

function GenericCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  return (
    <SuggestionCard s={s} actions={<Buttons s={s} busy={decide.isPending} acceptLabel="Annehmen" onAccept={() => decide.mutate({ decision: "accept" })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}>
        <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(s.payload, null, 2)}</pre>
    </SuggestionCard>
  );
}
