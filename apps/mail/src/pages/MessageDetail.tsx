import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Cpu, Forward, GraduationCap, ListChecks, MessagesSquare, MoreHorizontal, Paperclip, Receipt, RefreshCw, Reply, ReplyAll, ScanText, Send, Trash2, Undo2,
} from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import { AssignProject } from "@/components/AssignProject";
import { AssignUser } from "@/components/AssignUser";
import { HeroLink } from "@/components/HeroLink";
import { TeachBox } from "@/components/TeachBox";
import { DropboxSave } from "@/components/DropboxSave";
import { ElseDialog, TopicStatusDialog, useProjectStatus } from "@/components/DecideDialogs";
import { TopicHeroWork } from "@/components/HeroWork";
import { ConfirmDialog, Modal } from "@/components/ProjectActions";
import { SnoozePanel, useTopicDecide } from "@/components/TopicActions";
import { ProjectNr, type ProjectNrKind } from "@/components/ProjectNr";
import type { Topic } from "@/lib/topics";
import { ALTERNATIVES } from "@/lib/decide";
import { MailBody } from "@/components/MailBody";
import { Section } from "@/components/Section";
import { CATEGORY_LABELS, type Category } from "@/lib/shared";
import { useMe, visibleCategories } from "@/lib/me";
import { Badge, Button, buttonVariants, ErrorBox, Input, Select, Spinner, Textarea } from "@/components/ui";
import { cn, errorText, formatDate, formatDateTime, pct } from "@/lib/utils";

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
  /** Thema der Mail (fehlt bei einer aelteren email-api; null = gehoert zu keinem Thema, z. B. Werbung) */
  topic?: Topic | null;
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
function useDraft(m: any, onChanged: () => void) {
  return useMutation({
    mutationFn: (p: Record<string, unknown>) => invokeFn<{ written: boolean; text: string }>("email-draft", { messageId: m.id, ...p }),
    onSuccess: (r, p) => {
      toast.success(r.written ? "Entwurf liegt im Entwürfe-Ordner (nicht gesendet)." : p.action === "generate" ? "Entwurf erzeugt." : "Gespeichert.");
      onChanged();
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

/** Antwortentwurf (blauer Kasten): bearbeiten & senden, ins Postfach legen/ersetzen, neu erzeugen mit Hinweis. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DraftBox({ m, onChanged }: { m: any; onChanged: () => void }) {
  const navigate = useNavigate();
  const [text, setText] = useState<string>(m.draft_text ?? "");
  const [hint, setHint] = useState("");
  useEffect(() => { setText(m.draft_text ?? ""); }, [m.id, m.draft_text]);
  const run = useDraft(m, onChanged);
  const placeholders = (text.match(/\[\[[^\]]+\]\]/g) ?? []).length;
  return (
    <section aria-label="Antwortentwurf" className="space-y-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Antwortentwurf</h2>
        {m.draft_written_at ? <Badge variant="good">im Postfach</Badge> : <Badge variant="warn">nur hier – noch nicht im Postfach</Badge>}
      </div>
      <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} className="bg-background font-sans text-foreground" aria-label="Entwurfstext" />
      {placeholders > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">{placeholders} Platzhalter in [[ ]] müssen noch ausgefüllt werden.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={async () => {
          if (text !== (m.draft_text ?? "")) await run.mutateAsync({ action: "save", text }).catch(() => null);
          navigate(`/verfassen?reply=${m.id}&mode=reply&draft=1`);
        }} disabled={run.isPending}><Send className="h-3 w-3" /> Bearbeiten &amp; senden</Button>
        <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "save", text, write: true })} disabled={run.isPending}>{m.draft_written_at ? "Speichern & im Postfach ersetzen" : "In Postfach legen"}</Button>
        {text !== (m.draft_text ?? "") && <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "save", text })} disabled={run.isPending}>Nur speichern</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-72 max-w-full bg-background text-foreground" placeholder="Hinweis, z. B. „kürzer, per Du“ …" aria-label="Hinweis für den neuen Entwurf" value={hint} onChange={(e) => setHint(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "generate", hint: hint || undefined, write: !!m.draft_written_at })} disabled={run.isPending}>
          {run.isPending ? <Spinner /> : <RefreshCw className="h-3 w-3" />} Neu erzeugen …
        </Button>
      </div>
      <p className="text-xs opacity-80">„Bearbeiten &amp; senden“ öffnet den Entwurf zum Senden direkt aus der App (mit HTML-Signatur). „In Postfach legen“ legt ihn nur in den Ordner „Entwürfe“ – gesendet wird erst per Klick.</p>
    </section>
  );
}

/** Kein Entwurf: eine Zeile mit Grund und „Entwurf erzeugen“ (auf Wunsch mit Hinweis). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NoDraftLine({ m, onChanged }: { m: any; onChanged: () => void }) {
  const run = useDraft(m, onChanged);
  const [hint, setHint] = useState("");
  const why = ((Array.isArray(m.plan) ? m.plan : []) as { action: string; detail?: string }[]).find((p) => p.action === "draft")?.detail
    ?? (m.extracted?.reply?.reason ? String(m.extracted.reply.reason) : null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground">
      <span>Kein Entwurf{why ? ` – ${why.replace(/^Kein Entwurf:\s*/, "")}` : ""}.</span>
      <Input className="h-8 w-56 max-w-full" placeholder="Hinweis (optional), z. B. „per Du“ …" aria-label="Hinweis für den Entwurf" value={hint} onChange={(e) => setHint(e.target.value)} />
      <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "generate", hint: hint || undefined })} disabled={run.isPending}>
        {run.isPending ? <Spinner /> : <RefreshCw className="h-3 w-3" />} Entwurf erzeugen
      </Button>
    </div>
  );
}

/** Aufklapp-Menü (⋯) der Mail-Leiste: Escape und Klick daneben schließen; öffnet auf dem Handy nach oben (die Leiste klebt unten). */
function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Button size="sm" variant="outline" aria-label="Weitere Aktionen" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="max-md:h-11 max-md:w-11 max-md:px-0">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mb-1 w-64 overscroll-contain rounded-md border bg-background p-1 shadow-lg max-md:bottom-full md:top-full md:mt-1">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
function MenuItem({ onClick, children, danger, disabled }: { onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled}
      className={cn("flex w-full touch-manipulation items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-md:min-h-11", danger && "text-red-700 dark:text-red-300")}>
      {children}
    </button>
  );
}

type Dlg = null | "status" | "assign" | "hero" | "dropbox" | "teach" | "instruct" | "snooze" | "user" | "delete";

/** Text zum Zustand des Themas (wie früher in der TopicBar). */
function topicInfo(topic: Topic): string {
  if (topic.due) return "zu entscheiden";
  if (topic.state === "wiedervorlage") return `Wiedervorlage bis ${formatDateTime(topic.snoozedUntil)}${topic.note ? ` – „${topic.note}“` : ""}`;
  if (topic.state === "erledigt") return `abgeschlossen${topic.closedAt ? ` seit ${formatDateTime(topic.closedAt)}` : ""}`;
  return topic.nextCheck ? `wird überwacht, nächste Prüfung ${formatDateTime(topic.nextCheck)}` : "wird überwacht";
}

export default function MessageDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const me = useMe();
  const q = useQuery({ queryKey: ["message", id], queryFn: () => api<Detail>("get_message", { id }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dlg, setDlg] = useState<Dlg>(null);
  const m = q.data?.message;
  const topicDecide = useTopicDecide(q.data?.topic?.id ?? "");
  const projectStatus = useProjectStatus(m?.hero_project_match_id ?? null);

  useEffect(() => { setDraft({}); }, [id, m?.extracted]);
  useEffect(() => { setDlg(null); }, [id]);

  const correct = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ changed: number; learned: { pattern: string; category: string } | null }>("correct_message", { id, ...body }),
    onSuccess: (r) => {
      toast.success(r.learned ? `Gelernt: Mails von ${r.learned.pattern} sind künftig „${r.learned.category}“ (Regel angelegt).` : "Korrektur gespeichert – der Assistent lernt daraus."); qc.invalidateQueries({ queryKey: ["message", id] }); qc.invalidateQueries({ queryKey: ["messages"] }); },
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
      setDlg(null);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const reprocess = useMutation({
    mutationFn: () => api("reprocess_message", { id }),
    onSuccess: () => { toast.success("Wird beim nächsten Lauf neu verarbeitet."); qc.invalidateQueries({ queryKey: ["message", id] }); },
    onError: (e) => toast.error(errorText(e)),
  });

  const [showHiddenAtt, setShowHiddenAtt] = useState(false);
  const hideAtt = useMutation({
    mutationFn: (p: { attId: string; hidden: boolean }) => api("set_attachment_hidden", { id: p.attId, hidden: p.hidden }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["message"] }),
    onError: (e) => toast.error(errorText(e)),
  });
  const reloadAtt = useMutation({
    mutationFn: () => invokeFn<{ found: number; saved: number; failed: string[] }>("email-mailbox", { action: "attachments_reload", id }),
    onSuccess: (r) => {
      r.failed.forEach((f) => toast.error(f));
      toast.success(r.saved ? `${r.saved} Anhang/Anhänge nachgeladen.` : r.found ? "Alle Anhänge waren schon gespeichert." : "Die Mail hat keine Anhänge.");
      qc.invalidateQueries({ queryKey: ["message"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!m || !q.data) return null;
  const d = q.data;
  const topic = d.topic ?? null;
  const senderKnowledge = d.knowledge?.sender ?? [];
  const ex = m.extracted || {};
  const meta = ex._meta || {};
  const onChanged = () => qc.invalidateQueries({ queryKey: ["message", id] });

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
  const hiddenAtt = d.attachments.filter((a) => a.is_ignored);
  const hasAtt = d.attachments.some((a) => !a.is_ignored);
  const projectId: number | null = m.hero_project_match_id ?? null;
  const pKind: ProjectNrKind = d.suggestions.some((sg) => sg.status === "offen" && ALTERNATIVES.includes(sg.type)) ? "open" : projectId ? "assigned" : "none";
  const nr = m.match_info?.projectNr ?? m.hero_project_nr ?? projectStatus.data?.nr ?? (projectId ? `#${projectId}` : null);
  const pName = m.match_info?.projectName ?? projectStatus.data?.name ?? "";
  const kunde = m.match_info?.customer?.name ?? topic?.project?.kunde ?? null;
  const back = () => { if (loc.key !== "default") nav(-1); else nav("/mails"); };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 1. Kopfzeile */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={back} className="inline-flex touch-manipulation items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"><ArrowLeft className="h-4 w-4" /> Zurück</button>
        {topic && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <Link to="/themen" className="text-muted-foreground hover:underline" title="Alle Themen">
              <MessagesSquare className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden />Thema: {topicInfo(topic)}
            </Link>
            {topic.assignedTo && <Badge variant="secondary" title="Nur dieser Mitarbeiter bekommt das Thema zur Entscheidung">zugeordnet: {topic.assignedTo.name}</Badge>}
            {topic.due && <Link to={`/?topic=${topic.id}`} className={buttonVariants({ size: "sm" })}>Zur Entscheidung</Link>}
          </div>
        )}
      </div>

      {m.trashed_at && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Liegt im Papierkorb des Postfachs (seit {formatDateTime(m.trashed_at)}).</div>}
      {m.error && <ErrorBox error={m.error} />}

      {/* 2. Projekt-Leiste */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-3">
        <ProjectNr kind={pKind} nr={nr} size="head" />
        {pKind === "assigned" && projectId && (
          <button type="button" onClick={() => setDlg("status")} title="Status in HERO ändern"
            className="touch-manipulation rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9">
            {projectStatus.isLoading ? "Status …" : projectStatus.data?.stepName ? projectStatus.data.stepName.replace(/^[^\p{L}\p{N}]+/u, "") : "Status ändern"}
          </button>
        )}
        {pKind === "assigned" && (
          <span className="min-w-0 truncate text-sm"><b className="font-medium">{pName || "(ohne Namen)"}</b>{!m.match_info?.certain && " (vermutet)"}{kunde && <span className="text-muted-foreground"> · {kunde}</span>}</span>
        )}
        {pKind === "open" && <span className="text-sm text-muted-foreground">Neu oder bestehend – <Link className="underline" to={topic ? `/?topic=${topic.id}` : "/"}>zur Entscheidung</Link></span>}
        {pKind === "none" && <span className="text-sm text-muted-foreground">Kein Projekt zugeordnet{m.match_info?.reason ? ` (${m.match_info.reason})` : ""}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {projectId && <HeroLink id={projectId} label="In HERO öffnen" />}
          <Button size="sm" variant="outline" className="max-md:h-9" onClick={() => setDlg("assign")}>{projectId ? "Anderes Projekt" : "Projekt zuordnen"}</Button>
        </div>
      </div>

      {/* 3. Kopf */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h1 className="text-xl font-semibold leading-tight">{m.subject || "(ohne Betreff)"}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="text-foreground">{m.direction === "out" ? "an" : "von"} {m.direction === "out" ? (m.to_addrs || []).join(", ") : <><b className="font-medium">{m.from_name || m.from_addr}</b>{m.from_name ? ` <${m.from_addr}>` : ""}</>}</span>
          <span>· {formatDateTime(m.sent_at)}</span>
          <Select className="h-6 w-auto max-w-[14rem] rounded-full px-2 py-0 text-xs" aria-label="Kategorie korrigieren" title="Kategorie korrigieren – der Assistent lernt daraus" value={m.category ?? ""} onChange={(e) => correct.mutate({ category: e.target.value })}>
            {!m.category && <option value="" disabled>Kategorie wählen …</option>}
            {visibleCategories(me.data).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </Select>
          <span className="text-xs">Konfidenz {pct(m.confidence)}</span>
          {m.answered_at && <Badge variant="good"><Reply className="h-3 w-3" /> Beantwortet am {formatDateTime(m.answered_at)}</Badge>}
          {m.user_forwarded_at && <Badge variant="good"><Forward className="h-3 w-3" /> Weitergeleitet am {formatDateTime(m.user_forwarded_at)}</Badge>}
          {openSuggestions > 0 && <Link to={topic ? `/?topic=${topic.id}` : "/"}><Badge variant="warn">{openSuggestions} Vorschlag/Vorschläge offen</Badge></Link>}
        </div>
        <p className="text-sm">{m.summary || "Noch keine Zusammenfassung."}</p>
      </div>

      {/* 4. Mail-Leiste (Handy: klebt unten) */}
      <div className="z-20 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background px-4 py-2 max-md:sticky max-md:bottom-0 max-md:flex-nowrap max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Link to={`/verfassen?reply=${m.id}&mode=reply`} className={cn(buttonVariants({ size: "sm" }), "max-md:h-11 max-md:flex-1")}><Reply className="h-3.5 w-3.5" /> Antworten</Link>
        {(m.to_addrs?.length ?? 0) + (m.cc_addrs?.length ?? 0) > 1 && (
          <Link to={`/verfassen?reply=${m.id}&mode=replyAll`} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "max-md:h-11")}><ReplyAll className="h-3.5 w-3.5" /> Allen antworten</Link>
        )}
        <Link to={`/verfassen?reply=${m.id}&mode=forward`} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "max-md:h-11")}><Forward className="h-3.5 w-3.5" /> Weiterleiten</Link>
        <MoreMenu>
          {(close) => {
            const go = (x: Dlg) => () => { close(); setDlg(x); };
            return (
              <>
                {projectId && topic && <MenuItem onClick={go("hero")}>In HERO erledigen …</MenuItem>}
                {hasAtt && <MenuItem onClick={go("dropbox")}>In Dropbox …</MenuItem>}
                <MenuItem onClick={go("instruct")}>Anweisung …</MenuItem>
                <MenuItem onClick={go("teach")}><GraduationCap className="h-3.5 w-3.5" /> Falsch? Erklären …</MenuItem>
                <MenuItem onClick={() => { close(); reprocess.mutate(); }} disabled={reprocess.isPending}><RefreshCw className="h-3.5 w-3.5" /> Neu verarbeiten</MenuItem>
                {topic && !topic.due && (
                  <>
                    <div className="my-1 border-t" role="separator" />
                    {topic.state !== "erledigt" && <MenuItem onClick={go("snooze")}>Wiedervorlage …</MenuItem>}
                    {topic.state === "erledigt"
                      ? <MenuItem onClick={() => { close(); topicDecide.mutate({ decision: "oeffnen" }); }}>Wieder öffnen</MenuItem>
                      : <MenuItem onClick={() => { close(); topicDecide.mutate({ decision: "erledigt" }); }}>Thema abschließen</MenuItem>}
                    <MenuItem onClick={go("user")}>{topic.assignedTo ? `${topic.assignedTo.name} …` : "Mitarbeiter …"}</MenuItem>
                  </>
                )}
                <div className="my-1 border-t" role="separator" />
                {m.trashed_at
                  ? <MenuItem onClick={() => { close(); mailbox.mutate("restore"); }} disabled={mailbox.isPending}><Undo2 className="h-3.5 w-3.5" /> Wiederherstellen</MenuItem>
                  : <MenuItem danger onClick={go("delete")}><Trash2 className="h-3.5 w-3.5" /> Löschen</MenuItem>}
              </>
            );
          }}
        </MoreMenu>
      </div>

      {/* 5. Die Mail */}
      <div className="rounded-lg border bg-card p-4">
        <MailBody messageId={m.id} fallbackText={m.body_text} />
        {(m.has_attachments || attachments.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            {attachments.map((a) => (
              a.url
                ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-accent"><Paperclip className="h-3.5 w-3.5" />{a.filename}<span className="text-xs text-muted-foreground">{Math.round(a.size / 1024)} KB</span></a>
                : <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-sm text-muted-foreground"><Paperclip className="h-3.5 w-3.5" />{a.filename} (nicht gespeichert)</span>
            ))}
            {showHiddenAtt && hiddenAtt.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-sm text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">{a.filename}</a> : <>{a.filename} (nicht gespeichert)</>}
                <span className="text-xs">{Math.round(a.size / 1024)} KB</span>
                <button type="button" className="text-xs underline" disabled={hideAtt.isPending} onClick={() => hideAtt.mutate({ attId: a.id, hidden: false })}>einblenden</button>
              </span>
            ))}
            {hiddenAtt.length > 0 && (
              <span className="text-xs text-muted-foreground">+ {hiddenAtt.length} ausgeblendet{" "}
                <button type="button" className="underline" onClick={() => setShowHiddenAtt(!showHiddenAtt)}>{showHiddenAtt ? "verbergen" : "zeigen"}</button>
              </span>
            )}
            {(d.attachments.length === 0 || d.attachments.some((a) => !a.url)) && (
              <Button size="sm" variant="ghost" onClick={() => reloadAtt.mutate()} disabled={reloadAtt.isPending}>
                {reloadAtt.isPending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} {d.attachments.length ? "Fehlende Anhänge aus dem Postfach holen" : "Anhänge aus dem Postfach laden"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 6. Antwortentwurf – nur wenn einer existiert */}
      {m.direction === "in" && (m.draft_text ? <DraftBox m={m} onChanged={onChanged} /> : <NoDraftLine m={m} onChanged={onChanged} />)}

      {/* 7. Beleg */}
      {m.beleg_state && (
        <section aria-label="Beleg" className={cn("space-y-2 rounded-lg border p-4 text-sm", m.beleg_state === "portal_offen" ? "border-amber-400" : "border-amber-300", "bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100")}>
          <h2 className="flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4" aria-hidden /> Beleg
            <span className="font-normal opacity-80">· {({ portal_offen: "im Portal abzuholen", portal_erledigt: "Portal: abgeholt", weiterleiten_offen: "Weiterleitung an Lexware offen", weitergeleitet: "an Lexware weitergeleitet" } as Record<string, string>)[m.beleg_state]}</span>
          </h2>
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
        </section>
      )}

      {/* 8. Eingeklappt, ein gemeinsamer Rahmen */}
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {d.thread.length > 1 && (
          <Section flat id="thread" title="Verlauf" icon={<MessagesSquare className="h-4 w-4 text-muted-foreground" />} summary={`${d.thread.length} Mails in dieser Unterhaltung`}>
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

        {ex.contact && (
          <Section flat id="extracted" title="Erkannte Daten" icon={<ScanText className="h-4 w-4 text-muted-foreground" />}
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

        <Section flat id="assistant" title="Was der Assistent getan hat" icon={<ListChecks className="h-4 w-4 text-muted-foreground" />} summary={`${plan.length} ${plan.length === 1 ? "Schritt" : "Schritte"}`}>
          <div className="space-y-4">
            {plan.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{plan.some((p) => p.decision === "shadow") ? "Geplant (Schattenmodus)" : "Plan"}</h3>
                {plan.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={p.done ? "good" : p.decision === "shadow" ? "warn" : "secondary"}>{p.action}</Badge>
                    <span>{p.detail ?? p.decision}</span>
                  </div>
                ))}
              </div>
            )}

            {(m.correction_note || senderKnowledge.length > 0) && (
              <div className="space-y-1 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Korrektur &amp; Wissen</h3>
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
            )}

            <div className="space-y-1 text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">HERO-Zuordnung</h3>
              {projectId ? (
                <p>
                  Projekt <b>{m.match_info?.projectNr ?? `#${projectId}`}</b>{m.match_info?.projectName ? ` · ${m.match_info.projectName}` : ""}{" "}
                  <HeroLink id={projectId} label="in HERO öffnen" className="align-middle" />
                  {m.match_method ? ` – ${m.match_method}${m.match_info?.certain ? " (sicher)" : " (vermutet)"}` : ""}
                  {m.hero_logged_at ? ` · im Logbuch seit ${formatDateTime(m.hero_logged_at)}` : " · noch nicht im Logbuch"}
                </p>
              ) : (
                <p className="text-muted-foreground">Kein Projekt zugeordnet{m.match_info?.reason ? ` (${m.match_info.reason})` : ""}.</p>
              )}
              {d.suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {d.suggestions.map((sg) => <Badge key={sg.id} variant={sg.status === "offen" ? "warn" : "secondary"}>{sg.type}: {sg.status}</Badge>)}
                  <Link className="text-xs underline" to={topic ? `/?topic=${topic.id}` : "/"}>Zu entscheiden</Link>
                </div>
              )}
            </div>

            {d.shadow.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parallelvergleich · {d.shadow.some((s) => s.result && s.result.category !== m.category) ? "weicht ab" : "stimmt überein"}</h3>
                {d.shadow.map((s) => {
                  const differs = s.result && s.result.category !== m.category;
                  return (
                    <div key={s.id} className="space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{s.provider_name} · {s.model}</Badge>
                        {s.error ? <Badge variant="danger">{s.error}</Badge> : <Badge variant="outline">{s.result?.category ? CATEGORY_LABELS[s.result.category as Category] ?? s.result.category : "–"}</Badge>}
                        {differs && <Badge variant="warn">weicht ab</Badge>}
                      </div>
                      {s.result && <p className="text-xs text-muted-foreground">{s.result.request?.summary}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {d.calls.length > 0 && (
              <div className="space-y-1">
                <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Cpu className="h-3 w-3" aria-hidden /> KI-Aufrufe · {d.calls.length}{meta.source ? ` · ${meta.source === "ki" ? `${meta.provider ?? "KI"} ${meta.model ?? ""}` : `Regel (${meta.source})`}` : ""}</h3>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {d.calls.map((c, i) => (
                    <div key={i}>{c.task} · {c.model} · {c.tokens_in}/{c.tokens_out} Token{c.neurons ? ` · ${Math.round(c.neurons)} Neurons` : ""}{c.cost_usd ? ` · ${Number(c.cost_usd).toFixed(4)} $` : ""}{c.fallback ? " · Ausweich" : ""}{!c.ok ? ` · Fehler: ${c.error}` : ""}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* Dialoge */}
      {dlg === "status" && projectId && <TopicStatusDialog projectId={projectId} messageId={m.id} onClose={() => setDlg(null)} />}
      {dlg === "assign" && (
        <Modal title="Projekt zuordnen" onClose={() => setDlg(null)} wide>
          <AssignProject messageId={m.id} selectedId={projectId} autoFocus onDone={() => setDlg(null)} />
          <p className="text-xs text-muted-foreground">Die Zuordnung wird als Korrektur gespeichert. Ein bereits geschriebener Logbuch-Eintrag bleibt am alten Projekt stehen (manuell in HERO prüfen).</p>
        </Modal>
      )}
      {dlg === "hero" && projectId && topic && (
        <Modal title={`In HERO erledigen: ${nr ?? `#${projectId}`}`} onClose={() => setDlg(null)} wide>
          <TopicHeroWork threadId={topic.id} heroId={projectId} nr={nr ?? `#${projectId}`} onStarted={() => setDlg(null)} onDone={() => setDlg(null)} />
        </Modal>
      )}
      {dlg === "dropbox" && <Modal title="Anhänge in die Dropbox" onClose={() => setDlg(null)} wide><DropboxSave messageId={m.id} onClose={() => setDlg(null)} /></Modal>}
      {dlg === "instruct" && <ElseDialog messageId={m.id} fromAddr={m.from_addr} onClose={() => setDlg(null)} />}
      {dlg === "teach" && (
        <Modal title="Falsch? Erklären …" onClose={() => setDlg(null)} wide>
          <TeachBox messageId={m.id} fromAddr={m.from_addr} onCancel={() => setDlg(null)} onDone={() => setDlg(null)} />
        </Modal>
      )}
      {dlg === "snooze" && topic && (
        <Modal title="Wiedervorlage" onClose={() => setDlg(null)}>
          <SnoozePanel bare title={null} busy={topicDecide.isPending} submitLabel={(x) => `Wiedervorlage am ${formatDate(x)}`}
            onSnooze={(until, note) => topicDecide.mutate({ decision: "wiedervorlage", until, note, messageIds: topic.newMessages.map((x) => x.id) }, { onSuccess: () => setDlg(null) })} />
        </Modal>
      )}
      {dlg === "user" && topic && <Modal title="Mitarbeiter zuordnen" onClose={() => setDlg(null)} wide><AssignUser threadId={topic.id} onDone={() => setDlg(null)} /></Modal>}
      {dlg === "delete" && (
        <ConfirmDialog title="Mail löschen?" confirm="In den Papierkorb" danger busy={mailbox.isPending} onCancel={() => setDlg(null)} onConfirm={() => mailbox.mutate("trash")}
          text="Die Mail wandert in den Papierkorb des Postfachs und lässt sich von dort wiederherstellen." />
      )}
    </div>
  );
}
