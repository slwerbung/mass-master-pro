import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Cpu, Download, FolderKanban, GraduationCap, ListChecks, MessagesSquare, Paperclip, PenLine, Receipt, RefreshCw, Scale, ScanText, Trash2, Undo2,
} from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import { ProjectSearch } from "@/components/ProjectSearch";
import { TeachBox } from "@/components/TeachBox";
import { MailBody } from "@/components/MailBody";
import { Section } from "@/components/Section";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/shared";
import { Badge, Button, ErrorBox, Input, Select, Spinner, Textarea } from "@/components/ui";
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
  /** fehlt bei einer aelteren email-api */
  knowledge?: { sender: { id: string; text: string; from_pattern: string; source: string }[]; general: number };
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {m.draft_written_at && <Badge variant="good">im Postfach</Badge>}
        {hasDraft && !m.draft_written_at && <Badge variant="warn">nur hier – noch nicht im Postfach</Badge>}
      </div>
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
    </div>
  );
}

export default function MessageDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["message", id], queryFn: () => api<Detail>("get_message", { id }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [teach, setTeach] = useState(false);
  const m = q.data?.message;

  useEffect(() => { setDraft({}); }, [id, m?.extracted]);
  useEffect(() => { setTeach(false); }, [id]);

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
  const mailbox = useMutation({
    mutationFn: (action: "trash" | "restore") => invokeFn<{ moved: number; notInMailbox: number; errors: string[] }>("email-mailbox", { action, ids: [id] }),
    onSuccess: (r, action) => {
      if (r.errors.length) r.errors.forEach((e) => toast.error(e));
      else toast.success(action === "trash" ? "In den Papierkorb verschoben." : "Wiederhergestellt – liegt wieder im Posteingang.");
      ["message", "messages", "suggestions", "overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
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
  const senderKnowledge = d.knowledge?.sender ?? [];
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

  const plan = (Array.isArray(m.plan) ? m.plan : []) as PlanEntry[];
  const openSuggestions = d.suggestions.filter((sg) => sg.status === "offen").length;
  const attachments = d.attachments.filter((a) => !a.is_ignored);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/mails" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" /> Alle Mails</Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant={teach ? "secondary" : "outline"} onClick={() => setTeach(!teach)}><GraduationCap className="h-3.5 w-3.5" /> Falsch? Erklären</Button>
          <Button variant="outline" size="sm" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}><RefreshCw className="h-3.5 w-3.5" /> Neu verarbeiten</Button>
          {m.trashed_at ? (
            <Button variant="outline" size="sm" onClick={() => mailbox.mutate("restore")} disabled={mailbox.isPending}><Undo2 className="h-3.5 w-3.5" /> Wiederherstellen</Button>
          ) : (
            <Button variant="outline" size="sm" className="border-red-200 text-red-700 hover:bg-red-50" disabled={mailbox.isPending}
              onClick={() => { if (confirm("Mail in den Papierkorb des Postfachs verschieben?")) mailbox.mutate("trash"); }}>
              <Trash2 className="h-3.5 w-3.5" /> Löschen
            </Button>
          )}
        </div>
      </div>

      {m.trashed_at && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Liegt im Papierkorb des Postfachs (seit {formatDateTime(m.trashed_at)}).</div>}
      {m.error && <ErrorBox error={m.error} />}

      {/* Kopf: Betreff, Absender, KI-Einschaetzung */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h1 className="text-xl font-semibold leading-tight">{m.subject || "(ohne Betreff)"}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="text-foreground">{m.direction === "out" ? "an" : "von"} {m.direction === "out" ? (m.to_addrs || []).join(", ") : <><b className="font-medium">{m.from_name || m.from_addr}</b>{m.from_name ? ` <${m.from_addr}>` : ""}</>}</span>
          <span>· {formatDateTime(m.sent_at)}</span>
          {m.hero_project_match_id && <Badge variant="outline">{m.match_info?.projectNr ?? `HERO #${m.hero_project_match_id}`}</Badge>}
          {openSuggestions > 0 && <Link to="/"><Badge variant="warn">{openSuggestions} Vorschlag/Vorschläge offen</Badge></Link>}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2.5">
          <CategoryChip category={m.category} />
          <span className="text-xs text-muted-foreground">Konfidenz {pct(m.confidence)}</span>
          <p className="min-w-0 flex-1 basis-64 text-sm">{m.summary || "Noch keine Zusammenfassung."}</p>
          <Select className="h-8 w-52" value={m.category ?? ""} onChange={(e) => correct.mutate({ category: e.target.value })}>
            <option value="" disabled>Kategorie korrigieren …</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </Select>
        </div>
        {teach && <TeachBox messageId={m.id} fromAddr={m.from_addr} onCancel={() => setTeach(false)} onDone={() => setTeach(false)} />}
      </div>

      {/* Die Mail selbst */}
      <div className="rounded-lg border bg-card p-4">
        <MailBody messageId={m.id} fallbackText={m.body_text} />
        {attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
            {attachments.map((a) => (
              a.url
                ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-accent"><Paperclip className="h-3.5 w-3.5" />{a.filename}<span className="text-xs text-muted-foreground">{Math.round(a.size / 1024)} KB</span></a>
                : <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-sm text-muted-foreground"><Paperclip className="h-3.5 w-3.5" />{a.filename} (nicht gespeichert)</span>
            ))}
          </div>
        )}
      </div>

      {/* Hintergrundinfos: eingeklappt */}
      {m.direction === "in" && (
        <Section id="draft" title="Antwortentwurf" icon={<PenLine className="h-4 w-4 text-muted-foreground" />}
          summary={m.draft_written_at ? "liegt im Postfach (Entwürfe)" : m.draft_text ? "nur in der App – noch nicht im Postfach" : ex.reply ? `Antwort nötig: ${ex.reply.needed ? "ja" : "nein"}${ex.reply.reason ? ` – ${ex.reply.reason}` : ""}` : "kein Entwurf"}>
          <DraftCard m={m} onChanged={() => qc.invalidateQueries({ queryKey: ["message", id] })} />
        </Section>
      )}

      {m.beleg_state && (
        <Section id="beleg" title="Beleg" icon={<Receipt className="h-4 w-4 text-muted-foreground" />} tone={m.beleg_state === "portal_offen" ? "warn" : undefined}
          summary={({ portal_offen: "im Portal abzuholen", portal_erledigt: "Portal: abgeholt", weiterleiten_offen: "Weiterleitung an Lexware offen", weitergeleitet: "an Lexware weitergeleitet" } as Record<string, string>)[m.beleg_state]}>
          <div className="space-y-2 text-sm">
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
            {(m.category === "beleg" || m.extracted?.beleg?.is_booking_document) && m.has_attachments && !m.forwarded_at && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { if (confirm("Beleg jetzt an die Lexware-Belegadresse senden?")) forward.mutate(true); }} disabled={forward.isPending}>An Lexware senden</Button>
                <Button variant="ghost" size="sm" onClick={() => forward.mutate(false)} disabled={forward.isPending}>Nur Entwurf</Button>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section id="hero" title="HERO-Zuordnung" icon={<FolderKanban className="h-4 w-4 text-muted-foreground" />}
        summary={m.hero_project_match_id
          ? `${m.match_info?.projectNr ?? `#${m.hero_project_match_id}`}${m.match_info?.projectName ? ` · ${m.match_info.projectName}` : ""}${m.match_info?.certain ? " (sicher)" : " (vermutet)"}`
          : `kein Projekt${m.match_info?.reason ? ` – ${m.match_info.reason}` : ""}`}>
        <div className="space-y-3 text-sm">
          {m.hero_project_match_id ? (
            <p>
              Projekt <b>{m.match_info?.projectNr ?? `#${m.hero_project_match_id}`}</b>{m.match_info?.projectName ? ` · ${m.match_info.projectName}` : ""}
              {m.match_method ? ` – ${m.match_method}${m.match_info?.certain ? " (sicher)" : " (vermutet)"}` : ""}
              {m.hero_logged_at ? ` · im Logbuch seit ${formatDateTime(m.hero_logged_at)}` : " · noch nicht im Logbuch"}
            </p>
          ) : (
            <p className="text-muted-foreground">Kein Projekt zugeordnet{m.match_info?.reason ? ` (${m.match_info.reason})` : ""}.</p>
          )}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Projekt ändern / zuordnen</p>
            <ProjectSearch selectedId={m.hero_project_match_id} onPick={(p) => { if (confirm(`Mail dem Projekt ${p.nr} zuordnen und ins HERO-Logbuch schreiben?`)) assign.mutate(p.id); }} />
            <p className="text-xs text-muted-foreground">Die Zuordnung wird als Korrektur gespeichert. Ein bereits geschriebener Logbuch-Eintrag bleibt am alten Projekt stehen (manuell in HERO prüfen).</p>
          </div>
          {d.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.suggestions.map((sg) => <Badge key={sg.id} variant={sg.status === "offen" ? "warn" : "secondary"}>{sg.type}: {sg.status}</Badge>)}
              <Link className="text-xs underline" to="/">Zu entscheiden</Link>
            </div>
          )}
        </div>
      </Section>

      {plan.length > 0 && (
        <Section id="plan" title={plan.some((p) => p.decision === "shadow") ? "Geplant (Schattenmodus)" : "Was der Assistent getan hat"} icon={<ListChecks className="h-4 w-4 text-muted-foreground" />}
          summary={`${plan.filter((p) => p.done).length} von ${plan.length} erledigt`}>
          <div className="space-y-1">
            {plan.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={p.done ? "good" : p.decision === "shadow" ? "warn" : "secondary"}>{p.action}</Badge>
                <span>{p.detail ?? p.decision}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(m.correction_note || senderKnowledge.length > 0) && (
        <Section id="knowledge" title="Korrektur & Wissen" icon={<GraduationCap className="h-4 w-4 text-muted-foreground" />}
          summary={m.correction_note ? `Korrektur: ${m.correction_note}` : `${senderKnowledge.length} Eintrag/Einträge zu diesem Absender`}>
          <div className="space-y-1 text-sm">
            {m.correction_note && <p><b>Deine Korrektur zu dieser Mail:</b> {m.correction_note}</p>}
            {senderKnowledge.length > 0 && (
              <>
                <p className="font-medium">Wissen zu diesem Absender:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {senderKnowledge.map((k) => <li key={k.id}>{k.text} <span className="text-muted-foreground">({k.from_pattern})</span></li>)}
                </ul>
              </>
            )}
            <Link className="text-xs underline" to="/einstellungen/wissen">Wissensdatei öffnen{d.knowledge?.general ? ` (${d.knowledge.general} allgemeine Einträge)` : ""}</Link>
          </div>
        </Section>
      )}

      {ex.contact && (
        <Section id="extracted" title="Erkannte Daten" icon={<ScanText className="h-4 w-4 text-muted-foreground" />}
          summary={[[ex.contact.first_name, ex.contact.last_name].filter(Boolean).join(" "), ex.contact.company, ex.request?.service].filter(Boolean).join(" · ") || "–"}>
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
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={saveFields} disabled={!Object.keys(draft).length || correct.isPending}>Korrekturen speichern</Button>
            <span className="text-xs text-muted-foreground">
              Dringlichkeit: {ex.dates?.urgency ?? "–"} · Du/Sie: {ex.contact?.formality ?? "–"}
              {ex.references?.project_numbers?.length ? ` · Projektnummern: ${ex.references.project_numbers.join(", ")}` : ""}
            </span>
          </div>
        </Section>
      )}

      {d.thread.length > 1 && (
        <Section id="thread" title="Verlauf" icon={<MessagesSquare className="h-4 w-4 text-muted-foreground" />} summary={`${d.thread.length} Mails in dieser Unterhaltung`}>
          {d.thread.map((t) => (
            <div key={t.id} className={`rounded-md border p-3 text-sm ${t.id === m.id ? "border-primary" : ""}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t.direction === "out" ? "Gesendet" : "Erhalten"} von {t.from_name || t.from_addr}</span><span>· {formatDateTime(t.sent_at)}</span>
                {t.id !== m.id && <Link className="underline" to={`/mails/${t.id}`}>öffnen</Link>}
              </div>
              <div className="whitespace-pre-wrap">{t.body_text ?? "(Text nach der Aufbewahrungsfrist entfernt)"}</div>
            </div>
          ))}
        </Section>
      )}

      {(d.attachments.length > attachments.length) && (
        <Section id="ignored" title="Ausgeblendete Anhänge" icon={<Paperclip className="h-4 w-4 text-muted-foreground" />} summary={`${d.attachments.length - attachments.length} (Signaturbilder, sehr klein)`}>
          {d.attachments.filter((a) => a.is_ignored).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              {a.url ? <a className="inline-flex items-center gap-1 underline" href={a.url} target="_blank" rel="noreferrer"><Download className="h-3 w-3" />{a.filename}</a> : <span>{a.filename}</span>}
              <span className="text-xs text-muted-foreground">{Math.round(a.size / 1024)} KB · {a.mime}</span>
            </div>
          ))}
        </Section>
      )}

      {d.shadow.length > 0 && (
        <Section id="shadow" title="Parallelvergleich" icon={<Scale className="h-4 w-4 text-muted-foreground" />}
          summary={d.shadow.some((s) => s.result && s.result.category !== m.category) ? "weicht ab" : "stimmt überein"}>
          {d.shadow.map((s) => {
            const differs = s.result && s.result.category !== m.category;
            return (
              <div key={s.id} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{s.provider_name} · {s.model}</Badge>
                  {s.error ? <Badge variant="danger">{s.error}</Badge> : <CategoryChip category={s.result?.category} />}
                  {differs && <Badge variant="warn">weicht ab</Badge>}
                </div>
                {s.result && <p className="text-xs text-muted-foreground">{s.result.request?.summary}</p>}
              </div>
            );
          })}
        </Section>
      )}

      {d.calls.length > 0 && (
        <Section id="calls" title="KI-Aufrufe" icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
          summary={`${d.calls.length} Aufruf(e)${meta.source ? ` · ${meta.source === "ki" ? `${meta.provider ?? "KI"} ${meta.model ?? ""}` : `Regel (${meta.source})`}` : ""}`}>
          <div className="space-y-1 text-xs text-muted-foreground">
            {d.calls.map((c, i) => (
              <div key={i}>{c.task} · {c.model} · {c.tokens_in}/{c.tokens_out} Token{c.neurons ? ` · ${Math.round(c.neurons)} Neurons` : ""}{c.cost_usd ? ` · ${Number(c.cost_usd).toFixed(4)} $` : ""}{c.fallback ? " · Ausweich" : ""}{!c.ok ? ` · Fehler: ${c.error}` : ""}</div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
