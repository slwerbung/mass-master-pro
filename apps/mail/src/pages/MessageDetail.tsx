import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, RefreshCw, PenLine } from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import { ProjectSearch } from "@/components/ProjectSearch";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Input, Select, Spinner, Textarea } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { errorText, formatDateTime, pct } from "@/lib/utils";

/* Der Inhalt von `extracted` ist ein freies JSON aus dem Modell. */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface PlanEntry { action: string; decision: string; done: boolean; detail?: string }
interface Detail {
  message: any;
  thread: { id: string; direction: string; from_addr: string; from_name: string; subject: string; sent_at: string | null; summary: string | null; category: Category | null; body_text: string | null }[];
  attachments: { id: string; filename: string; mime: string; size: number; role: string | null; is_ignored: boolean; url: string | null }[];
  shadow: { id: string; task: string; provider_name: string; model: string; result: any; error: string | null }[];
  suggestions: { id: string; type: string; status: string }[];
  calls: { task: string; provider_type: string; model: string; tokens_in: number; tokens_out: number; neurons: number; cost_usd: number; ok: boolean; fallback: boolean; error: string | null }[];
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Felder, die in der Detailansicht korrigierbar sind. Jede Aenderung landet in email_feedback.
const FIELDS: { group: string; key: string; label: string }[] = [
  { group: "contact", key: "first_name", label: "Vorname" }, { group: "contact", key: "last_name", label: "Nachname" },
  { group: "contact", key: "company", label: "Firma" }, { group: "contact", key: "email", label: "E-Mail" },
  { group: "contact", key: "phone", label: "Telefon" }, { group: "contact", key: "street", label: "Straße" },
  { group: "contact", key: "zip", label: "PLZ" }, { group: "contact", key: "city", label: "Ort" },
  { group: "request", key: "service", label: "Leistung" }, { group: "request", key: "dimensions", label: "Maße" },
  { group: "request", key: "quantity", label: "Menge" }, { group: "request", key: "material", label: "Material" },
  { group: "request", key: "location", label: "Einsatzort" },
  { group: "dates", key: "wish_date", label: "Wunschtermin" }, { group: "dates", key: "deadline", label: "Deadline" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DraftCard({ m, onChanged }: { m: any; onChanged: () => void }) {
  const [text, setText] = useState<string>(m.draft_text ?? "");
  const [hint, setHint] = useState("");
  useEffect(() => { setText(m.draft_text ?? ""); }, [m.id, m.draft_text]);
  const run = useMutation({
    mutationFn: (p: Record<string, unknown>) => invokeFn<{ written: boolean; text: string }>("email-draft", { messageId: m.id, ...p }),
    onSuccess: (r, p) => {
      toast.success(r.written ? "Entwurf liegt im Entwürfe-Ordner (nicht gesendet)." : p.action === "generate" ? "Entwurf erzeugt." : "Gespeichert.");
      onChanged();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const placeholders = (text.match(/\[\[[^\]]+\]\]/g) ?? []).length;
  const hasDraft = !!m.draft_text;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PenLine className="h-4 w-4" /> Antwortentwurf
          {m.draft_written_at && <Badge variant="good">im Postfach</Badge>}
          {hasDraft && !m.draft_written_at && <Badge variant="warn">nur hier – noch nicht im Postfach</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasDraft ? (
          <>
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="font-sans" />
            {placeholders > 0 && <p className="text-xs text-amber-800">{placeholders} Platzhalter in [[ ]] müssen noch ausgefüllt werden.</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Kein Entwurf. Der Assistent schreibt nur einen, wenn eine Antwort per Mail wirklich nötig ist – du kannst jederzeit einen anstoßen.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {hasDraft && <Button size="sm" onClick={() => run.mutate({ action: "save", text, write: true })} disabled={run.isPending}>{m.draft_written_at ? "Speichern & im Postfach ersetzen" : "In Postfach legen"}</Button>}
          {hasDraft && text !== (m.draft_text ?? "") && <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "save", text })} disabled={run.isPending}>Nur speichern</Button>}
          <Input className="w-64" placeholder="Hinweis, z. B. „kürzer“" value={hint} onChange={(e) => setHint(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "generate", hint: hint || undefined, write: !!m.draft_written_at })} disabled={run.isPending}>
            {run.isPending ? <Spinner /> : <RefreshCw className="h-3 w-3" />} {hasDraft ? "Neu erzeugen" : "Entwurf erzeugen"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Es wird nichts versendet: der Entwurf liegt im Ordner „Entwürfe“ und wird in Thunderbird geprüft und gesendet.</p>
      </CardContent>
    </Card>
  );
}

export default function MessageDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["message", id], queryFn: () => api<Detail>("get_message", { id }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const m = q.data?.message;

  useEffect(() => { setDraft({}); }, [id, m?.extracted]);

  const correct = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ changed: number; learned: { pattern: string; category: string } | null }>("correct_message", { id, ...body }),
    onSuccess: (r) => {
      toast.success(r.learned ? `Gelernt: Mails von ${r.learned.pattern} sind künftig „${r.learned.category}“ (Regel angelegt).` : "Korrektur gespeichert – der Assistent lernt daraus."); qc.invalidateQueries({ queryKey: ["message", id] }); qc.invalidateQueries({ queryKey: ["messages"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const assign = useMutation({
    mutationFn: (projectId: number) => invokeFn("email-action", { action: "assign", messageId: id, projectId }),
    onSuccess: () => { toast.success("Zugeordnet und ins Logbuch geschrieben."); qc.invalidateQueries({ queryKey: ["message", id] }); qc.invalidateQueries({ queryKey: ["messages"] }); qc.invalidateQueries({ queryKey: ["overview"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const forward = useMutation({
    mutationFn: (send: boolean) => invokeFn<{ files: number; how: "gesendet" | "entwurf"; fallbackReason: string | null }>("email-draft", { action: "forward_beleg", messageId: id, send }),
    onSuccess: (r) => {
      if (r.how === "gesendet") toast.success(`An Lexware gesendet (${r.files} Anhang/Anhänge).`);
      else toast.warning(`Entwurf an Lexware liegt im Entwürfe-Ordner${r.fallbackReason ? ` (Senden nicht möglich: ${r.fallbackReason})` : ""} – bitte selbst senden.`); qc.invalidateQueries({ queryKey: ["message", id] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const belegState = useMutation({
    mutationFn: (state: string) => api("set_beleg_state", { id, state }),
    onSuccess: () => { toast.success("Gespeichert"); qc.invalidateQueries({ queryKey: ["message", id] }); qc.invalidateQueries({ queryKey: ["messages"] }); qc.invalidateQueries({ queryKey: ["digest"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const reprocess = useMutation({
    mutationFn: () => api("reprocess_message", { id }),
    onSuccess: () => { toast.success("Wird beim nächsten Lauf neu verarbeitet."); qc.invalidateQueries({ queryKey: ["message", id] }); },
    onError: (e) => toast.error(errorText(e)),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!m || !q.data) return null;
  const d = q.data;
  const ex = m.extracted || {};
  const meta = ex._meta || {};

  const saveFields = () => {
    const extracted: Record<string, Record<string, string | null>> = {};
    for (const f of FIELDS) {
      const k = `${f.group}.${f.key}`;
      if (draft[k] !== undefined) (extracted[f.group] ||= {})[f.key] = draft[k].trim() || null;
    }
    if (Object.keys(extracted).length) correct.mutate({ extracted });
  };

  return (
    <div className="space-y-4">
      <Link to="/mails" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" /> Alle Mails</Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{m.subject || "(ohne Betreff)"}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{m.direction === "out" ? "an" : "von"} {m.direction === "out" ? (m.to_addrs || []).join(", ") : `${m.from_name ? m.from_name + " " : ""}<${m.from_addr}>`}</span>
          <span>· {formatDateTime(m.sent_at)}</span>
          <Badge variant="secondary">{m.status}</Badge>
          {m.hero_project_match_id && <Badge variant="outline">HERO #{m.hero_project_match_id}{m.match_method ? ` (${m.match_method})` : ""}</Badge>}
        </div>
      </div>

      {m.error && <ErrorBox error={m.error} />}

      <Card>
        <CardHeader><CardTitle>Zusammenfassung</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{m.summary || "Noch keine Zusammenfassung."}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={m.category} />
            <span className="text-xs text-muted-foreground">Konfidenz {pct(m.confidence)}</span>
            {meta.source && <Badge variant="outline">{meta.source === "ki" ? `${meta.provider ?? "KI"} · ${meta.model ?? ""}${meta.fallback ? " (Ausweich)" : ""}` : `Regel (${meta.source})`}</Badge>}
            <Select className="ml-auto w-56" value={m.category ?? ""} onChange={(e) => correct.mutate({ category: e.target.value })}>
              <option value="" disabled>Kategorie korrigieren …</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </Select>
          </div>
          {ex.reply && <p className="text-xs text-muted-foreground">Antwort nötig: <b>{ex.reply.needed ? "ja" : "nein"}</b> – {ex.reply.reason}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}><RefreshCw className="h-3 w-3" /> Neu verarbeiten</Button>
            {(m.category === "beleg" || m.extracted?.beleg?.is_booking_document) && m.has_attachments && !m.forwarded_at && (
              <>
                <Button variant="outline" size="sm" onClick={() => { if (confirm("Beleg jetzt an die Lexware-Belegadresse senden?")) forward.mutate(true); }} disabled={forward.isPending}>An Lexware senden</Button>
                <Button variant="ghost" size="sm" onClick={() => forward.mutate(false)} disabled={forward.isPending}>Nur Entwurf</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {m.beleg_state && (
        <Card>
          <CardHeader><CardTitle>Beleg</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {m.beleg_state === "portal_offen" && (
              <>
                <p>Die Rechnung{m.beleg_vendor ? ` von ${m.beleg_vendor}` : ""} liegt nur im Kundenportal. Bitte dort herunterladen und verbuchen – die Mail liegt solange im Ordner „Belege abholen“.</p>
                <Button size="sm" onClick={() => belegState.mutate("portal_erledigt")} disabled={belegState.isPending}>Abgeholt und verbucht</Button>
              </>
            )}
            {m.beleg_state === "portal_erledigt" && <p>Portal-Rechnung abgeholt und verbucht. <Button variant="ghost" size="sm" onClick={() => belegState.mutate("portal_offen")}>Wieder öffnen</Button></p>}
            {m.beleg_state === "weiterleiten_offen" && (
              <>
                <p>Beleg mit Anhang, noch nicht an Lexware weitergeleitet (automatisch bei neuen Mails, sobald Belegadresse und SMTP-Server hinterlegt sind).</p>
                <Button size="sm" variant="outline" onClick={() => belegState.mutate("weitergeleitet")} disabled={belegState.isPending}>Als weitergeleitet markieren</Button>
              </>
            )}
            {m.beleg_state === "weitergeleitet" && <p>An Lexware weitergeleitet{m.forwarded_at ? ` am ${formatDateTime(m.forwarded_at)}` : ""}.</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>HERO-Zuordnung</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {m.hero_project_match_id ? (
            <p>
              Projekt <b>{m.match_info?.projectNr ?? `#${m.hero_project_match_id}`}</b>{m.match_info?.projectName ? ` · ${m.match_info.projectName}` : ""}
              {m.match_method ? ` – ${m.match_method}${m.match_info?.certain ? " (sicher)" : " (vermutet)"}` : ""}
              {m.hero_logged_at ? ` · im Logbuch seit ${formatDateTime(m.hero_logged_at)}` : " · noch nicht im Logbuch"}
            </p>
          ) : (
            <p className="text-muted-foreground">Kein Projekt zugeordnet{m.match_info?.reason ? ` (${m.match_info.reason})` : ""}.</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Projekt ändern / zuordnen</summary>
            <div className="mt-2 space-y-2">
              <ProjectSearch selectedId={m.hero_project_match_id} onPick={(p) => { if (confirm(`Mail dem Projekt ${p.nr} zuordnen und ins HERO-Logbuch schreiben?`)) assign.mutate(p.id); }} />
              <p className="text-xs text-muted-foreground">Die Zuordnung wird als Korrektur gespeichert. Ein bereits geschriebener Logbuch-Eintrag bleibt am alten Projekt stehen (manuell in HERO prüfen).</p>
            </div>
          </details>
          {d.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.suggestions.map((sg) => <Badge key={sg.id} variant={sg.status === "offen" ? "warn" : "secondary"}>{sg.type}: {sg.status}</Badge>)}
              <Link className="text-xs underline" to="/">Zu entscheiden</Link>
            </div>
          )}
          {Array.isArray(m.plan) && m.plan.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground">{m.plan.some((p: PlanEntry) => p.decision === "shadow") ? "Geplant (Schattenmodus – nichts wurde verändert)" : "Was der Assistent getan hat"}</h4>
              {(m.plan as PlanEntry[]).map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant={p.done ? "good" : p.decision === "shadow" ? "warn" : "secondary"}>{p.action}</Badge>
                  <span>{p.detail ?? p.decision}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {m.direction === "in" && <DraftCard m={m} onChanged={() => qc.invalidateQueries({ queryKey: ["message", id] })} />}

      {ex.contact && (
        <Card>
          <CardHeader><CardTitle>Erkannte Daten</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => {
                const k = `${f.group}.${f.key}`;
                const cur = ex[f.group]?.[f.key] ?? "";
                return (
                  <label key={k} className="space-y-1 text-xs text-muted-foreground">
                    {f.label}
                    <Input value={draft[k] ?? String(cur)} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={saveFields} disabled={!Object.keys(draft).length || correct.isPending}>Korrekturen speichern</Button>
              <span className="text-xs text-muted-foreground">
                Dringlichkeit: {ex.dates?.urgency ?? "–"} · Du/Sie: {ex.contact?.formality ?? "–"}
                {ex.references?.project_numbers?.length ? ` · Projektnummern: ${ex.references.project_numbers.join(", ")}` : ""}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Verlauf ({d.thread.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {d.thread.map((t) => (
            <div key={t.id} className={`rounded-md border p-3 text-sm ${t.id === m.id ? "border-primary" : ""}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t.direction === "out" ? "Gesendet" : "Erhalten"} von {t.from_name || t.from_addr}</span><span>· {formatDateTime(t.sent_at)}</span>
                {t.id !== m.id && <Link className="underline" to={`/mails/${t.id}`}>öffnen</Link>}
              </div>
              <div className="whitespace-pre-wrap">{t.body_text ?? "(Text nach der Aufbewahrungsfrist entfernt)"}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {d.attachments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Anhänge</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.attachments.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                {a.url ? <a className="inline-flex items-center gap-1 underline" href={a.url} target="_blank" rel="noreferrer"><Download className="h-3 w-3" />{a.filename}</a> : <span>{a.filename}</span>}
                <span className="text-xs text-muted-foreground">{Math.round(a.size / 1024)} KB · {a.mime}</span>
                {a.role && <Badge variant="outline">{a.role}</Badge>}
                {a.is_ignored && <Badge variant="secondary">ignoriert (Signatur/zu klein)</Badge>}
                {!a.url && !a.is_ignored && <Badge variant="warn">nicht gespeichert</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {d.shadow.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Parallelvergleich (Schattenmodus)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.shadow.map((s) => {
              const differs = s.result && s.result.category !== m.category;
              return (
                <div key={s.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{s.provider_name} · {s.model}</Badge>
                    {s.error ? <Badge variant="danger">{s.error}</Badge> : <CategoryChip category={s.result?.category} />}
                    {differs && <Badge variant="warn">weicht ab</Badge>}
                  </div>
                  {s.result && <p className="text-xs text-muted-foreground">{s.result.request?.summary}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {d.calls.length > 0 && (
        <Card>
          <CardHeader><CardTitle>KI-Aufrufe</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {d.calls.map((c, i) => (
              <div key={i}>{c.task} · {c.model} · {c.tokens_in}/{c.tokens_out} Token{c.neurons ? ` · ${Math.round(c.neurons)} Neurons` : ""}{c.cost_usd ? ` · ${Number(c.cost_usd).toFixed(4)} $` : ""}{c.fallback ? " · Ausweich" : ""}{!c.ok ? ` · Fehler: ${c.error}` : ""}</div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
