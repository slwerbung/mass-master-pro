import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, invokeFn } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { ProjectSearch } from "@/components/ProjectSearch";
import { errorText, formatDateTime, pct } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  create_project: "Kontakt + Projekt anlegen", link_project: "Projekt zuordnen", log_entry: "Ins Logbuch schreiben",
  change_step: "Statuswechsel", upload_attachments: "Anhänge ans Projekt", prepare_offer: "Angebot vorbereiten",
};

interface Gewerk { short: string; name: string; measure_id: number | null }

function useDecide(s: Suggestion) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ["suggestions"] }); qc.invalidateQueries({ queryKey: ["overview"] }); qc.invalidateQueries({ queryKey: ["messages"] }); };
  const decide = useMutation({
    mutationFn: ({ decision, edits }: { decision: "accept" | "reject"; edits?: Record<string, unknown> }) =>
      invokeFn<{ warnings?: string[]; projectNr?: string }>("email-action", { action: "decide", suggestionId: s.id, decision, edits }),
    onSuccess: (r, v) => {
      if (v.decision === "reject") toast("Abgelehnt – der Assistent merkt es sich.");
      else toast.success(r.projectNr ? `Angelegt: ${r.projectNr}` : "Erledigt");
      r.warnings?.forEach((w) => toast.warning(w));
      done();
    },
    onError: (e) => { toast.error(errorText(e)); done(); },
  });
  return decide;
}

function Header({ s }: { s: Suggestion }) {
  const m = s.message;
  return (
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{TYPE_LABEL[s.type] ?? s.type}</Badge>
        <CategoryChip category={m.category} />
        {m.confidence != null && <span className="text-xs text-muted-foreground">Konfidenz {pct(m.confidence)}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.sent_at)}</span>
      </div>
      <CardTitle className="pt-1"><Link className="hover:underline" to={`/mails/${m.id}`}>{m.subject || "(ohne Betreff)"}</Link></CardTitle>
      <p className="text-xs text-muted-foreground">{m.direction === "out" ? "an" : "von"} {m.from_name || m.from_addr}</p>
      {m.summary && <p className="text-sm">{m.summary}</p>}
    </CardHeader>
  );
}

function Buttons({ onAccept, onReject, acceptLabel, busy, disabled }: { onAccept: () => void; onReject: () => void; acceptLabel: string; busy: boolean; disabled?: boolean }) {
  return (
    <div className="flex gap-2">
      <Button onClick={onAccept} disabled={busy || disabled}>{busy ? <Spinner /> : null} {acceptLabel}</Button>
      <Button variant="outline" onClick={onReject} disabled={busy}>Ablehnen</Button>
    </div>
  );
}

function LinkCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const cands = (s.payload.candidates ?? []) as { id: number; nr: string; name: string; stepName: string | null }[];
  const [projectId, setProjectId] = useState<number | null>(s.payload.projectId ?? null);
  const [text, setText] = useState<string>(s.payload.text ?? "");
  const [showSearch, setShowSearch] = useState(false);
  return (
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
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
        <Buttons busy={decide.isPending} disabled={!projectId} acceptLabel="Zuordnen & ins Logbuch" onAccept={() => decide.mutate({ decision: "accept", edits: { projectId, text } })} onReject={() => decide.mutate({ decision: "reject" })} />
      </CardContent>
    </Card>
  );
}

function LogCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const [text, setText] = useState<string>(s.payload.text ?? "");
  return (
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
        <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>{s.payload.projectName ? ` · ${s.payload.projectName}` : ""}</p>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <Buttons busy={decide.isPending} acceptLabel="Ins Logbuch" onAccept={() => decide.mutate({ decision: "accept", edits: { text } })} onReject={() => decide.mutate({ decision: "reject" })} />
      </CardContent>
    </Card>
  );
}

function StepCard({ s }: { s: Suggestion }) {
  const decide = useDecide(s);
  const alts = (s.payload.alternatives ?? []) as { key: string; stepId: number; label: string }[];
  const [stepId, setStepId] = useState<number>(s.payload.toStepId);
  return (
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
        <p className="text-sm">Projekt <b>{s.payload.projectNr ?? s.payload.projectId}</b>: {s.payload.reason}.</p>
        <Field label="Neuer Schritt">
          <Select value={stepId} onChange={(e) => setStepId(Number(e.target.value))}>
            <option value={s.payload.toStepId}>{s.payload.toLabel}</option>
            {alts.map((a) => <option key={a.stepId} value={a.stepId}>{a.label}</option>)}
          </Select>
        </Field>
        {s.payload.hint && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Hinweis: {s.payload.hint}</p>}
        <Buttons busy={decide.isPending} acceptLabel="Status wechseln" onAccept={() => decide.mutate({ decision: "accept", edits: { toStepId: stepId } })} onReject={() => decide.mutate({ decision: "reject" })} />
      </CardContent>
    </Card>
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
  return (
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
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
        <Buttons busy={decide.isPending} disabled={!items.some((i) => i.selected)} acceptLabel="Hochladen" onAccept={() => decide.mutate({ decision: "accept", edits: { items } })} onReject={() => decide.mutate({ decision: "reject" })} />
      </CardContent>
    </Card>
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
  return (
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
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
        <Buttons
          busy={decide.isPending} acceptLabel="In HERO anlegen"
          onAccept={() => decide.mutate({ decision: "accept", edits: { contact: c, project: { name, notes, gewerk: gewerke.find((g) => g.short === gw) ?? null } } })}
          onReject={() => decide.mutate({ decision: "reject" })}
        />
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
      {q.data && !q.data.length && <Card><CardContent className="p-6 text-sm text-muted-foreground">Keine offenen Vorschläge. 🎉</CardContent></Card>}
      <div className="space-y-4">
        {q.data?.map((s) => {
          switch (s.type) {
            case "link_project": return <LinkCard key={s.id} s={s} />;
            case "log_entry": return <LogCard key={s.id} s={s} />;
            case "change_step": return <StepCard key={s.id} s={s} />;
            case "create_project": return <ProjectCard key={s.id} s={s} gewerke={gewerke} />;
            case "upload_attachments": return <UploadCard key={s.id} s={s} />;
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
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
        <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(s.payload, null, 2)}</pre>
        <Buttons busy={decide.isPending} acceptLabel="Annehmen" onAccept={() => decide.mutate({ decision: "accept" })} onReject={() => decide.mutate({ decision: "reject" })} />
      </CardContent>
    </Card>
  );
}
