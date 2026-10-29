import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, invokeFn } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ProjectSearch } from "@/components/ProjectSearch";
import { ConfirmationCard, SendDocumentCard } from "@/components/OrderCards";
import {
  AlternativesCard, AlternativesPicker, Buttons, ExistingCustomerChoice, quoted, SuggestionCard, typeLabel, useDecide, useRejectAll,
  type ExistingCustomer,
} from "@/components/SuggestionParts";
import { CategoryChip } from "@/components/CategoryChip";
import { MailBody } from "@/components/MailBody";
import { TopicActions } from "@/components/TopicActions";
import { DropboxSave } from "@/components/DropboxSave";
import { FolderInput, Mail, Paperclip, Receipt } from "lucide-react";
import type { Overview } from "@/lib/types";
import type { Topic, TopicMail } from "@/lib/topics";
import { TOPIC_REASON_LABELS } from "@/lib/shared";
import { errorText, formatDate, formatDateTime } from "@/lib/utils";

interface Gewerk { short: string; name: string; measure_id: number | null }

/** Eingebettet in eine Alternativen-Karte: ohne eigenen Kopf, „Nicht nötig“ verwirft alle Varianten. */
interface AltProps { embedded?: boolean; onSkip?: (reason: string) => void }

function LinkCard({ s, embedded, onSkip }: { s: Suggestion } & AltProps) {
  const decide = useDecide(s);
  const cands = (s.payload.candidates ?? []) as { id: number; nr: string; name: string; stepName: string | null }[];
  const [projectId, setProjectId] = useState<number | null>(s.payload.projectId ?? null);
  const [text, setText] = useState<string>(s.payload.text ?? "");
  const [showSearch, setShowSearch] = useState(false);
  const chosen = cands.find((c) => c.id === projectId);
  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={chosen ? `${chosen.nr} ${chosen.name || ""}` : projectId ? (s.payload.projectNr ?? `#${projectId}`) : `${cands.length} Projekte zur Auswahl`}
      actions={<Buttons s={s} busy={decide.isPending} disabled={!projectId} acceptLabel={projectId ? `Zu ${chosen?.nr ?? s.payload.projectNr ?? `#${projectId}`} zuordnen und ins Logbuch schreiben` : "Erst unter „Vorschlag“ ein Projekt wählen"} onAccept={() => decide.mutate({ decision: "accept", edits: { projectId, text } })} onReject={onSkip ?? ((reason) => decide.mutate({ decision: "reject", edits: { reason } }))} />}
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

function LogCard({ s, embedded }: { s: Suggestion } & AltProps) {
  const decide = useDecide(s);
  const [text, setText] = useState<string>(s.payload.text ?? "");
  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={`${s.payload.projectNr ?? s.payload.projectId}${s.payload.projectName ? ` ${s.payload.projectName}` : ""}`}
      actions={<Buttons s={s} busy={decide.isPending} acceptLabel={`Ins Logbuch von ${s.payload.projectNr ?? `#${s.payload.projectId}`} schreiben`} onAccept={() => decide.mutate({ decision: "accept", edits: { text } })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}
    >
        <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>{s.payload.projectName ? ` · ${s.payload.projectName}` : ""}</p>
        <Field label="Logbuch-Eintrag"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </SuggestionCard>
  );
}

function StepCard({ s, embedded }: { s: Suggestion } & AltProps) {
  const decide = useDecide(s);
  const alts = (s.payload.alternatives ?? []) as { key: string; stepId: number; label: string }[];
  const [stepId, setStepId] = useState<number>(s.payload.toStepId);
  const label = stepId === s.payload.toStepId ? s.payload.toLabel : alts.find((a) => a.stepId === stepId)?.label;
  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={`${s.payload.projectNr ?? s.payload.projectId} → ${label ?? "?"}`}
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

function UploadCard({ s, embedded }: { s: Suggestion } & AltProps) {
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
      s={s} embedded={embedded} brief={`${n} von ${items.length} Anhang/Anhänge → ${s.payload.projectNr ?? s.payload.projectId}`}
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

function OfferCard({ s, embedded }: { s: Suggestion } & AltProps) {
  const decide = useDecide(s);
  const [kind, setKind] = useState<"angebot" | "vor_ort">(s.payload.kind);
  const [positions, setPositions] = useState<OfferPos[]>(s.payload.positions ?? []);
  const upd = (i: number, p: Partial<OfferPos>) => setPositions(positions.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const missing = (s.payload.missing ?? []) as string[];
  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={kind === "angebot" ? `Angebot mit ${positions.length} Position(en)` : "Vor-Ort-Termin"}
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

function ProjectCard({ s, gewerke, embedded, onSkip }: { s: Suggestion; gewerke: Gewerk[] } & AltProps) {
  const decide = useDecide(s);
  const p = s.payload;
  const [c, setC] = useState({ ...p.contact });
  const [name, setName] = useState<string>(p.project?.name ?? "");
  const [notes, setNotes] = useState<string>(p.project?.notes ?? "");
  const [gw, setGw] = useState<string>(p.project?.gewerk?.short ?? "");
  const existing = (p.existingCustomer ?? null) as ExistingCustomer | null;
  const [useExisting, setUseExisting] = useState(!!existing);
  const set = (k: string, v: string) => setC({ ...c, [k]: v });
  const fields: [string, string][] = [
    ["salutation", "Anrede"], ["first_name", "Vorname"], ["last_name", "Nachname"], ["company", "Firma"], ["email", "E-Mail"],
    ["phone", "Telefon"], ["street", "Straße"], ["zip", "PLZ"], ["city", "Ort"],
  ];
  const images = s.attachments.filter((a) => a.url);
  const fromExisting = !!existing && useExisting;
  const who = fromExisting ? existing!.name : c.company || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email;
  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={`${name || "(ohne Projektname)"}${who ? ` · ${who}${fromExisting ? " (bestehender Kunde)" : " (neuer Kontakt)"}` : ""}`}
      actions={
        <Buttons
          s={s} busy={decide.isPending}
          acceptLabel={fromExisting
            ? `Neues Projekt ${quoted(name)} beim bestehenden Kunden ${who} in HERO anlegen`
            : `Neuen Kontakt${who ? ` ${who}` : ""} und Projekt ${quoted(name)} in HERO anlegen`}
          onAccept={() => decide.mutate({ decision: "accept", edits: { contact: c, useExisting: fromExisting, project: { name, notes, gewerk: gewerke.find((g) => g.short === gw) ?? null } } })}
          onReject={onSkip ?? ((reason) => decide.mutate({ decision: "reject", edits: { reason } }))}
        />
      }
    >
        {existing && <ExistingCustomerChoice customer={existing} useExisting={useExisting} onChange={setUseExisting} />}
        {!fromExisting && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([k, l]) => <Field key={k} label={l}><Input value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>)}
          </div>
        )}
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

interface Digest { portalOpen: { id: string }[]; claims: { id: string }[] }

/** Kopfzeile: alles mit einem Klick erreichbar (Themen-Ansichten, Belege im Portal, Reklamationen). */
function OverviewBar({ due }: { due: number }) {
  const ov = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("overview"), refetchInterval: 60_000 });
  const dg = useQuery({ queryKey: ["digest"], queryFn: () => api<Digest>("digest"), refetchInterval: 300_000 });
  const t = ov.data?.topics;
  const chip = (to: string, label: string, n: number | undefined, tone?: "warn" | "danger") => (
    <Link key={to} to={to} className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm hover:bg-accent">
      {label}<Badge variant={n ? tone ?? "secondary" : "outline"}>{n ?? "–"}</Badge>
    </Link>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {chip("/", "Zu entscheiden", due, "danger")}
      {chip("/themen?view=laufend", "Laufende Themen", t?.laufend)}
      {chip("/themen?view=wiedervorlage", "Wiedervorlage", t?.wiedervorlage)}
      {!!dg.data?.claims.length && chip("/mails?category=reklamation", "Reklamationen offen", dg.data.claims.length, "danger")}
      {!!dg.data?.portalOpen.length && chip("/mails?belegState=portal_offen", "Belege im Portal abholen", dg.data.portalOpen.length, "warn")}
    </div>
  );
}

const REASON_TONE: Record<string, "default" | "warn" | "danger" | "secondary"> = {
  neu: "default", wieder_offen: "warn", vorschlag: "default", wiedervorlage: "secondary", unbeantwortet: "danger", nachfassen: "warn",
};

/** Eine vorgelegte Mail im Thema: Kurzfassung, aufklappbar. */
function NewMail({ m }: { m: TopicMail }) {
  const [open, setOpen] = useState(false);
  const [dropbox, setDropbox] = useState(false);
  const qc = useQueryClient();
  // Beleg an die Lexware-Belegadresse (derselbe Weg wie in der Mail-Ansicht; erledigt die Mail damit).
  const lexware = useMutation({
    mutationFn: () => invokeFn<{ files: number; how: "gesendet" | "entwurf"; fallbackReason: string | null }>("email-draft", { action: "forward_beleg", messageId: m.id, send: true }),
    onSuccess: (r) => {
      if (r.how === "gesendet") toast.success(`An Lexware gesendet (${r.files} Anhang/Anhänge).`);
      else toast.warning(`Entwurf an Lexware liegt im Entwürfe-Ordner${r.fallbackReason ? ` (Senden nicht möglich: ${r.fallbackReason})` : ""} – bitte selbst senden.`);
    },
    onError: (e) => toast.error(errorText(e)),
    onSettled: () => ["topics", "overview", "messages", "message"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{m.from_name || m.from_addr}</span>
        <CategoryChip category={m.category} />
        {m.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.sent_at)}</span>
      </div>
      {m.summary ? <p className="text-sm">{m.summary}</p> : <p className="text-sm text-muted-foreground">{m.subject || "(ohne Betreff)"}</p>}
      <div className="flex gap-3 text-xs">
        <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
          <Mail className="h-3.5 w-3.5" /> {open ? "Mail zuklappen" : "Mail lesen"}
        </button>
        <Link to={`/mails/${m.id}`} className="text-muted-foreground underline hover:text-foreground">Öffnen</Link>
        {m.category === "beleg" && m.has_attachments && (
          <button type="button" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline" disabled={lexware.isPending}
            onClick={() => { if (confirm("Beleg jetzt an die Lexware-Belegadresse senden?")) lexware.mutate(); }}>
            <Receipt className="h-3.5 w-3.5" /> {lexware.isPending ? "Sende …" : "An Lexware senden"}
          </button>
        )}
        {m.has_attachments && (
          <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setDropbox(!dropbox)}>
            <FolderInput className="h-3.5 w-3.5" /> Anhänge in Dropbox
          </button>
        )}
      </div>
      {dropbox && <DropboxSave messageId={m.id} onClose={() => setDropbox(false)} />}
      {open && <div className="rounded-md border p-2"><MailBody messageId={m.id} fallbackText={null} /></div>}
    </div>
  );
}

/**
 * Ein Thema = eine Karte: warum es vorliegt, die neuen Mails, die Vorschläge des Assistenten,
 * darunter die Entscheidung (antworten, Anweisung, weiter verfolgen, Wiedervorlage, abschließen).
 */
function TopicCard({ topic, suggestions, gewerke }: { topic: Topic; suggestions: Suggestion[]; gewerke: Gewerk[] }) {
  const units = groupByMessage(suggestions).flat();
  const cat = topic.newMessages[0]?.category ?? null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {topic.reason && <Badge variant={REASON_TONE[topic.reason] ?? "default"}>{topic.reasonText || TOPIC_REASON_LABELS[topic.reason]}</Badge>}
          {cat && <CategoryChip category={cat} />}
          {topic.state === "wiedervorlage" && topic.snoozedUntil && <span className="text-xs text-muted-foreground">fällig seit {formatDate(topic.snoozedUntil)}</span>}
          <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(topic.lastActivity)}</span>
        </div>
        <CardTitle className="pt-1"><Link className="hover:underline" to={`/mails/${topic.latestId}`}>{topic.subject}</Link></CardTitle>
        <p className="text-xs text-muted-foreground">
          {topic.from && <>mit {topic.from} · </>}{topic.messageCount} {topic.messageCount === 1 ? "Mail" : "Mails"} im Thema
          {topic.newMessages.length > 1 && <> · <b>{topic.newMessages.length} neue</b></>}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {topic.newMessages.map((m) => <NewMail key={m.id} m={m} />)}
        {!topic.newMessages.length && topic.lastMail && (
          <p className="rounded-md bg-muted/40 p-3 text-sm">
            <span className="text-xs text-muted-foreground">
              Zuletzt {topic.lastMail.direction === "out" ? "wir" : topic.lastMail.from}, {formatDateTime(topic.lastMail.sent_at)}:{" "}
            </span>
            {topic.lastMail.summary || "(ohne Inhalt)"}
          </p>
        )}
        {units.map((u, i) => (
          <section key={Array.isArray(u) ? u.map((s) => s.id).join() : u.id} className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{i + 1}</span>
              Vorschlag: {Array.isArray(u) ? "Neues Projekt oder bestehendes?" : typeLabel(u)}
            </div>
            {Array.isArray(u) ? <ProjectChoice items={u} gewerke={gewerke} embedded /> : <One s={u} gewerke={gewerke} embedded />}
          </section>
        ))}
        <div className="border-t pt-3"><TopicActions topic={topic} /></div>
      </CardContent>
    </Card>
  );
}

export default function Decide() {
  const topics = useQuery({ queryKey: ["topics", "entscheiden"], queryFn: () => api<Topic[]>("list_topics", { view: "entscheiden" }), refetchInterval: 60_000 });
  const q = useQuery({ queryKey: ["suggestions"], queryFn: () => api<Suggestion[]>("list_suggestions", { status: "offen" }), refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ gewerke: Gewerk[] | null }>("get_config") });
  const gewerke = cfg.data?.gewerke ?? [];
  const byId = new Map((q.data ?? []).map((s) => [s.id, s]));
  const list = topics.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Zu entscheiden</h1>
        {(topics.isFetching || q.isFetching) && <Spinner />}
      </div>
      <ErrorBox error={topics.error ?? q.error} />
      <OverviewBar due={list.length} />
      {topics.data && !list.length && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Nichts zu entscheiden – jede Mail ist bearbeitet. 🎉 Laufende Themen werden weiter überwacht.</CardContent></Card>
      )}
      <div className="space-y-4">
        {list.map((t) => (
          <TopicCard key={t.id} topic={t} gewerke={gewerke}
            suggestions={t.suggestionIds.map((id) => byId.get(id)).filter((s): s is Suggestion => !!s)} />
        ))}
      </div>
    </div>
  );
}

function GenericCard({ s, embedded }: { s: Suggestion } & AltProps) {
  const decide = useDecide(s);
  return (
    <SuggestionCard s={s} embedded={embedded} actions={<Buttons s={s} busy={decide.isPending} acceptLabel="Annehmen" onAccept={() => decide.mutate({ decision: "accept" })} onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })} />}>
        <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(s.payload, null, 2)}</pre>
    </SuggestionCard>
  );
}

function One({ s, gewerke, embedded }: { s: Suggestion; gewerke: Gewerk[]; embedded?: boolean }) {
  switch (s.type) {
    case "link_project": return <LinkCard s={s} embedded={embedded} />;
    case "log_entry": return <LogCard s={s} embedded={embedded} />;
    case "change_step": return <StepCard s={s} embedded={embedded} />;
    case "create_project": return <ProjectCard s={s} gewerke={gewerke} embedded={embedded} />;
    case "upload_attachments": return <UploadCard s={s} embedded={embedded} />;
    case "prepare_offer": return <OfferCard s={s} embedded={embedded} />;
    case "create_confirmation": return <ConfirmationCard s={s} embedded={embedded} />;
    case "send_document": return <SendDocumentCard s={s} embedded={embedded} />;
    default: return <GenericCard s={s} embedded={embedded} />;
  }
}

const ALTERNATIVES = ["create_project", "link_project"];
/** Reihenfolge der Entscheidungen in einer Karte: erst das Projekt, dann was daran haengt. */
const ORDER = ["create_project", "link_project", "create_confirmation", "upload_attachments", "prepare_offer", "change_step", "log_entry", "send_document"];
const rank = (t: string) => (ORDER.includes(t) ? ORDER.indexOf(t) : ORDER.length);

/** Eine Entscheidung: ein einzelner Vorschlag oder die Wahl „Projekt anlegen“ / „Projekt zuordnen“. */
type Unit = Suggestion | Suggestion[];

/**
 * Alle offenen Vorschlaege derselben Mail zusammenfassen (an der Stelle des ersten) – eine Mail = eine Karte.
 * „Projekt anlegen“ + „Projekt zuordnen“ werden darin zu einer Wahl.
 */
function groupByMessage(list: Suggestion[]): Unit[][] {
  const byMsg = new Map<string, Suggestion[]>();
  for (const s of list) (byMsg.get(s.message.id) ?? byMsg.set(s.message.id, []).get(s.message.id)!).push(s);
  return [...byMsg.values()].map((all) => {
    const sorted = [...all].sort((a, b) => rank(a.type) - rank(b.type));
    const alts = sorted.filter((s) => ALTERNATIVES.includes(s.type));
    const units: Unit[] = [];
    for (const s of sorted) {
      if (alts.length > 1 && ALTERNATIVES.includes(s.type)) { if (s === alts[0]) units.push(alts); continue; }
      units.push(s);
    }
    return units;
  });
}

function ProjectChoice({ items, gewerke, embedded }: { items: Suggestion[]; gewerke: Gewerk[]; embedded?: boolean }) {
  const skip = useRejectAll(items.map((s) => s.id));
  const onSkip = (reason: string) => skip.mutate(reason);
  const choices = items.map((s) => s.type === "create_project"
    ? { s, title: "Neues Projekt anlegen", render: (e: true) => <ProjectCard s={s} gewerke={gewerke} embedded={e} onSkip={onSkip} /> }
    : { s, title: `Zu bestehendem Projekt (${(s.payload.candidates ?? []).length || 1})`, render: (e: true) => <LinkCard s={s} embedded={e} onSkip={onSkip} /> });
  return embedded ? <AlternativesPicker items={choices} /> : <AlternativesCard label="Neues Projekt oder bestehendes?" items={choices} />;
}
