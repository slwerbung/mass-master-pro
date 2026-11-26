import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, FolderInput, Paperclip } from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import type { Overview } from "@/lib/types";
import type { Topic, TopicMail } from "@/lib/topics";
import { CATEGORY_STYLE } from "@/lib/projects";
import { TOPIC_REASON_LABELS } from "@/lib/shared";
import {
  acceptCount, acceptEdits, ALTERNATIVES, BELEG_TEXT, canAccept, DEFAULT_REASON, initialEdits, rank, runRows, shortText, shortWhen, stackLabel,
  type Edits, type Gewerk, type RunRow,
} from "@/lib/decide";
import { Button, buttonVariants, Card, CardContent, ErrorBox, Spinner } from "@/components/ui";
import { HeroLink } from "@/components/HeroLink";
import { useHeroViewer } from "@/components/HeroViewer";
import { ProjectNr, type ProjectNrKind } from "@/components/ProjectNr";
import { prefersReducedMotion, StackItemFrame, useIsMobile, useStackKeys } from "@/components/Stack";
import { SuggestionRow, type RowStatus } from "@/components/SuggestionRow";
import { LinkFields, LogFields, OfferFields, ProjectFields, StepFields, UploadFields } from "@/components/SuggestionFields";
import { ConfirmationFields, SendDocumentPanel } from "@/components/OrderCards";
import { decideSuggestion } from "@/components/SuggestionParts";
import { LaterDialog, ElseDialog, TopicStatusDialog, useProjectStatus } from "@/components/DecideDialogs";
import { Modal } from "@/components/ProjectActions";
import { AssignProject } from "@/components/AssignProject";
import { AssignUser } from "@/components/AssignUser";
import { DropboxSave } from "@/components/DropboxSave";
import { HeroTaskBox, TopicHeroWork } from "@/components/HeroWork";
import { MailBody } from "@/components/MailBody";
import { useTopicDecide } from "@/components/TopicActions";
import { papi, type HeroTaskInfo } from "@/lib/projects";
import { cn, errorText, formatDate, formatDateTime } from "@/lib/utils";

/* Der Inhalt eines Vorschlags ist je Art ein freies JSON. */
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Digest { portalOpen: { id: string }[]; claims: { id: string }[] }
type DialogKind = "status" | "later" | "else" | "assign" | "user" | "dropbox" | "hero";
interface DialogState { kind: DialogKind; messageId?: string }

const clean = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, "");
const newest = (t: Topic): TopicMail | undefined => t.newMessages[t.newMessages.length - 1];
/** Mail, auf die sich Antworten/Weiterleiten/Anweisungen beziehen: die neueste neue, sonst die jüngste im Thema. */
const targetOf = (t: Topic) => newest(t)?.id ?? t.latestId;

type Cand = { id: number; nr: string; name: string; stepName: string | null };

/** Was die Karte über das Projekt weiß: zugeordnet, „Projekt?“ (Neu oder bestehend) oder ohne Projekt. */
function projectKind(t: Topic, sugg: Suggestion[]): ProjectNrKind {
  if (sugg.some((s) => ALTERNATIVES.includes(s.type))) return "open";
  return t.projectId ? "assigned" : "none";
}

export default function Decide() {
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const topics = useQuery({ queryKey: ["topics", "entscheiden"], queryFn: () => api<Topic[]>("list_topics", { view: "entscheiden" }), refetchInterval: 60_000, refetchOnWindowFocus: true });
  const sq = useQuery({ queryKey: ["suggestions"], queryFn: () => api<Suggestion[]>("list_suggestions", { status: "offen" }), refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ gewerke: Gewerk[] | null }>("get_config") });
  const ov = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("overview"), refetchInterval: 60_000 });
  const dg = useQuery({ queryKey: ["digest"], queryFn: () => api<Digest>("digest"), refetchInterval: 300_000 });
  const list = topics.data ?? [];
  const byId = useMemo(() => new Map((sq.data ?? []).map((s) => [s.id, s])), [sq.data]);

  // Ausgewähltes Thema steht in der Adresse (/?topic=…, replace); ohne Parameter das erste.
  const topicParam = params.get("topic");
  const selected = list.find((t) => t.id === topicParam) ?? list[0] ?? null;
  const select = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("topic", id); else n.delete("topic"); return n; }, { replace: true });
  const [mobileOpen, setMobileOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Nach Abschließen/Später/Ausführen: nächstes Thema (Handy: aufklappen und in den Blick scrollen).
  const afterAction = (t: Topic) => {
    const i = list.findIndex((x) => x.id === t.id);
    const next = list[i + 1] ?? list[i - 1] ?? null;
    select(next?.id ?? null);
    setMobileOpen(true);
    setDialog(null);
    if (next) setScrollTo(next.id);
    ["topics", "suggestions", "overview", "messages"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  // Desktop: gewählten Eintrag in der Liste sichtbar halten, Karte oben beginnen.
  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mobile || !selected) return;
    itemRefs.current[selected.id]?.scrollIntoView({ block: "nearest" });
    paneRef.current?.scrollTo({ top: 0 });
  }, [selected?.id, mobile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!scrollTo || !mobile) return;
    const el = itemRefs.current[scrollTo];
    if (el) { el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }); setScrollTo(null); }
  });

  const step = (d: 1 | -1) => {
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((t) => t.id === selected?.id));
    const n = list[Math.min(Math.max(i + d, 0), list.length - 1)];
    if (n) { select(n.id); setMobileOpen(true); }
  };
  const tap = (t: Topic) => {
    if (t.id === selected?.id) { if (mobile) setMobileOpen(!mobileOpen); return; }
    select(t.id); setMobileOpen(true);
  };

  const pane = (t: Topic, joined: boolean) => (
    <div className={cn(joined && "[&>*]:rounded-t-none [&>*]:border-t-0")}>
      <TopicPane key={t.id} topic={t} suggestions={t.suggestionIds.map((id) => byId.get(id)).filter((s): s is Suggestion => !!s)} gewerke={cfg.data?.gewerke ?? []}
        dialogOpen={!!dialog} openDialog={(kind, messageId) => setDialog({ kind, messageId })} onNext={() => step(1)} onPrev={() => step(-1)} onFinished={() => afterAction(t)} onChanged={() => ["topics", "suggestions", "overview", "messages"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))} />
    </div>
  );

  const t = ov.data?.topics;
  const tabs: [string, string, string | null][] = [
    ["stapel", `Stapel (${list.length})`, null],
    ["laufend", `Laufend${t ? ` (${t.laufend})` : ""}`, "/themen?view=laufend"],
    ["wiedervorlage", `Wiedervorlagen${t ? ` (${t.wiedervorlage})` : ""}`, "/themen?view=wiedervorlage"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold">Zu entscheiden</h1>
        {(topics.isFetching || sq.isFetching) && <Spinner />}
        <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {!!dg.data?.claims.length && <Link to="/mails?category=reklamation" className="text-red-700 underline-offset-2 hover:underline dark:text-red-300">Reklamation offen {dg.data.claims.length}</Link>}
          {!!dg.data?.portalOpen.length && <Link to="/mails?belegState=portal_offen" className="text-amber-800 underline-offset-2 hover:underline dark:text-amber-300">Belege im Portal {dg.data.portalOpen.length}</Link>}
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(([k, label, to]) => to ? (
          <Link key={k} to={to} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">{label}</Link>
        ) : (
          <span key={k} aria-current="page" className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium">{label}</span>
        ))}
      </div>

      <ErrorBox error={topics.error ?? sq.error} />
      {topics.data && !list.length && (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">Nichts zu entscheiden – jede Mail ist bearbeitet. Laufende Themen werden weiter überwacht.</p>
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[22rem_minmax(0,1fr)] md:items-start">
          {/* Desktop: Liste und Karte scrollen je für sich – man bleibt oben, statt weit unten zu landen. */}
          <div ref={listRef} className="space-y-2 md:sticky md:top-4 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto md:overscroll-contain md:pr-1">
            {list.map((tp) => {
              const open = mobile && tp.id === selected?.id && mobileOpen;
              const sg = tp.suggestionIds.map((id) => byId.get(id)).filter((s): s is Suggestion => !!s);
              return (
                <div key={tp.id} ref={(el) => { itemRefs.current[tp.id] = el; }} className="scroll-mt-16">
                  <StackEntry topic={tp} suggestions={sg} active={tp.id === selected?.id} expanded={open} onClick={() => tap(tp)} />
                  {open && pane(tp, true)}
                </div>
              );
            })}
          </div>
          {!mobile && <div ref={paneRef} className="min-w-0 md:sticky md:top-4 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto md:overscroll-contain">{selected && pane(selected, false)}</div>}
        </div>
      )}

      {selected && dialog?.kind === "status" && selected.projectId && <TopicStatusDialog projectId={selected.projectId} messageId={targetOf(selected)} onClose={() => setDialog(null)} />}
      {selected && dialog?.kind === "later" && <LaterDialog topic={selected} onClose={() => setDialog(null)} onDone={() => afterAction(selected)} />}
      {selected && dialog?.kind === "else" && <ElseDialog messageId={targetOf(selected)} fromAddr={newest(selected)?.from_addr ?? ""} onClose={() => setDialog(null)} />}
      {selected && dialog?.kind === "assign" && (
        <Modal title="Projekt zuordnen" onClose={() => setDialog(null)} wide>
          <AssignProject messageId={targetOf(selected)} selectedId={selected.projectId} autoFocus={!mobile} onDone={() => setDialog(null)} />
        </Modal>
      )}
      {selected && dialog?.kind === "user" && (
        <Modal title="Mitarbeiter zuordnen" onClose={() => setDialog(null)} wide><AssignUser threadId={selected.id} onDone={() => setDialog(null)} /></Modal>
      )}
      {dialog?.kind === "dropbox" && dialog.messageId && (
        <Modal title="Anhänge in die Dropbox" onClose={() => setDialog(null)} wide><DropboxSave messageId={dialog.messageId} onClose={() => setDialog(null)} /></Modal>
      )}
      {selected && dialog?.kind === "hero" && selected.projectId && (
        <Modal title={`In HERO erledigen: ${selected.project?.nr ?? `#${selected.projectId}`}`} onClose={() => setDialog(null)} wide>
          <TopicHeroWork threadId={selected.id} heroId={selected.projectId} nr={selected.project?.nr ?? `#${selected.projectId}`} onStarted={() => setDialog(null)} onDone={() => setDialog(null)} />
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Stapel-Eintrag
function StackEntry({ topic, suggestions, active, expanded, onClick }: { topic: Topic; suggestions: Suggestion[]; active: boolean; expanded: boolean; onClick: () => void }) {
  const kind = projectKind(topic, suggestions);
  const label = stackLabel(newest(topic)?.category, topic.reason);
  const create = suggestions.find((s) => s.type === "create_project");
  const projectName = kind === "assigned" ? topic.project?.name : kind === "open" ? create?.payload?.project?.name : null;
  const title = projectName || topic.subject || "(ohne Betreff)";
  const third = kind === "none"
    ? [topic.from, topic.reasonText || (topic.reason ? TOPIC_REASON_LABELS[topic.reason] : "")].filter(Boolean).join(" · ")
    : [topic.from, topic.subject].filter(Boolean).join(" · ");
  return (
    <StackItemFrame active={active} joined={expanded} onClick={onClick} ariaExpanded={expanded}>
      <div className="flex items-center gap-2">
        <ProjectNr kind={kind} nr={topic.project?.nr ?? (topic.projectId ? `#${topic.projectId}` : null)} />
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", CATEGORY_STYLE[label.style])}>{label.text}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{shortWhen(topic.lastActivity)}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{title}</div>
      {!expanded && (
        <div className="truncate text-xs text-muted-foreground">{topic.assignedTo && <b>{topic.assignedTo.name} · </b>}{third}</div>
      )}
    </StackItemFrame>
  );
}

// ------------------------------------------------------------------ Karte
interface RowDef {
  key: string;
  type: string;
  /** Vorschlag (fehlt bei der Beleg-Zeile) */
  s?: Suggestion;
  /** die Beleg-Mail */
  mail?: TopicMail;
  text: string;
  selectable: boolean;
  /** Varianten der Projektwahl, die mit dieser Zeile verworfen werden */
  siblings: Suggestion[];
}
interface RowUi { checked: boolean; open: boolean; reason: string; status: RowStatus }
const defaultUi: RowUi = { checked: true, open: false, reason: "", status: "open" };

function TopicPane({ topic, suggestions, gewerke, dialogOpen, openDialog, onNext, onPrev, onFinished, onChanged }: {
  topic: Topic; suggestions: Suggestion[]; gewerke: Gewerk[]; dialogOpen: boolean; openDialog: (k: DialogKind, messageId?: string) => void;
  onNext: () => void; onPrev: () => void; onFinished: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const decide = useTopicDecide(topic.id);
  const kind = projectKind(topic, suggestions);
  const status = useProjectStatus(kind === "assigned" ? topic.projectId : null);

  // ---- Projektwahl (Kopf): Neu anlegen oder bestehendes. Vorbelegt ist der Vorschlag des Assistenten.
  const group = useMemo(() => {
    const first = suggestions.filter((s) => ALTERNATIVES.includes(s.type)).sort((a, b) => rank(a.type) - rank(b.type))[0];
    const mine = first ? suggestions.filter((s) => s.message.id === first.message.id && ALTERNATIVES.includes(s.type)) : [];
    return { create: mine.find((s) => s.type === "create_project"), link: mine.find((s) => s.type === "link_project"), ids: new Set(mine.map((s) => s.id)) };
  }, [suggestions]);
  const cands = useMemo<Cand[]>(() => {
    const p = group.link?.payload;
    if (!p) return [];
    const out: Cand[] = [...((p.candidates ?? []) as Cand[])];
    if (p.projectId && !out.some((c) => c.id === p.projectId)) out.unshift({ id: p.projectId, nr: p.projectNr ?? `#${p.projectId}`, name: p.projectName ?? "", stepName: null });
    return out;
  }, [group.link]);
  const [choice, setChoice] = useState<"new" | number | null>(() => (group.link?.payload?.projectId ? group.link.payload.projectId : group.create ? "new" : null));
  const chosen = typeof choice === "number" ? cands.find((c) => c.id === choice) : undefined;

  // ---- Felder und Zeilenzustand
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const editsOf = (s: Suggestion): Edits => edits[s.id] ?? initialEdits(s);
  const [ui, setUi] = useState<Record<string, RowUi>>({});
  const uiOf = (key: string): RowUi => ui[key] ?? defaultUi;
  const patch = (key: string, p: Partial<RowUi>) => setUi((u) => ({ ...u, [key]: { ...(u[key] ?? defaultUi), ...p } }));
  /** erledigte/verworfene Zeilen bleiben sichtbar, auch wenn die Liste neu geladen wird */
  const [finished, setFinished] = useState<Record<string, { text: string; rank: number }>>({});

  const rows = useMemo<RowDef[]>(() => {
    const out: RowDef[] = [];
    const projectRow = choice === "new" ? group.create : group.link ?? group.create;
    for (const s of [...suggestions].sort((a, b) => rank(a.type) - rank(b.type))) {
      if (group.ids.has(s.id) && s !== projectRow) continue;
      const e = edits[s.id] ?? initialEdits(s);
      const siblings = s === projectRow ? suggestions.filter((x) => group.ids.has(x.id) && x !== s) : [];
      out.push({
        key: s.id, type: s.type, s, siblings, selectable: s.type !== "send_document",
        text: shortText(s, e, { linkNr: s === group.link ? chosen?.nr ?? s.payload?.projectNr : undefined }),
      });
    }
    for (const m of topic.newMessages) {
      if (m.category === "beleg" && m.has_attachments && m.belegState !== "weitergeleitet") {
        out.push({ key: `beleg:${m.id}`, type: "beleg", mail: m, text: BELEG_TEXT, selectable: true, siblings: [] });
      }
    }
    return out;
  }, [suggestions, group, choice, edits, topic.newMessages, chosen]);

  const sendDocs = rows.filter((r) => r.type === "send_document");
  const openRows = rows.filter((r) => r.type !== "send_document" && !finished[r.key]);
  const runRowsIn: (RunRow & { def: RowDef })[] = openRows.map((r) => ({ key: r.key, type: r.type, checked: uiOf(r.key).checked, def: r }));
  const n = acceptCount(runRowsIn);
  const ctxFor = (s: Suggestion) => ({ gewerke, projectId: s.type === "link_project" && typeof choice === "number" ? choice : undefined });
  const blocked = openRows.find((r) => r.s && uiOf(r.key).checked && !canAccept(r.s, editsOf(r.s), ctxFor(r.s)));
  const nothingOpen = openRows.length === 0 && sendDocs.length === 0;

  // ---- Ausführen: nacheinander in der Reihenfolge von ORDER, beim ersten Fehler anhalten
  const run = useMutation({
    mutationFn: async () => {
      const outcome = await runRows(runRowsIn, async (row, mode) => {
        const def = row.def;
        const reason = uiOf(def.key).reason.trim() || DEFAULT_REASON;
        if (def.type === "beleg") {
          const r = await invokeFn<{ files: number; how: "gesendet" | "entwurf"; fallbackReason: string | null }>("email-draft", { action: "forward_beleg", messageId: def.mail!.id, send: true });
          if (r.how === "gesendet") toast.success(`An Lexware gesendet (${r.files} Anhang/Anhänge).`);
          else toast.warning(`Entwurf an Lexware liegt im Entwürfe-Ordner${r.fallbackReason ? ` (Senden nicht möglich: ${r.fallbackReason})` : ""} – bitte selbst senden.`);
          return;
        }
        const s = def.s!;
        if (mode === "accept") {
          const r = await decideSuggestion(s.id, "accept", acceptEdits(s, editsOf(s), ctxFor(s)));
          r.warnings?.forEach((w) => toast.warning(w));
        } else {
          for (const x of [s, ...def.siblings]) await decideSuggestion(x.id, "reject", { reason });
        }
      });
      return outcome;
    },
    onSuccess: (o) => {
      const keys = Object.keys(o.status);
      setFinished((f) => ({ ...f, ...Object.fromEntries(keys.map((k) => { const d = openRows.find((r) => r.key === k)!; return [k, { text: d.text, rank: rank(d.type) }]; })) }));
      setUi((u) => ({ ...u, ...Object.fromEntries(keys.map((k) => [k, { ...(u[k] ?? defaultUi), status: o.status[k] === "accepted" ? "accepted" : "rejected" } as RowUi])) }));
      if (o.failed) {
        const d = openRows.find((r) => r.key === o.failed!.key);
        toast.error(`${d?.text ?? "Aktion"}: ${o.failed.error}`, { duration: 10000 });
        onChanged();
      } else {
        toast.success(keys.length === 1 ? "1 Aktion ausgeführt." : `${keys.length} Aktionen ausgeführt.`);
        onChanged();
        const rest = sendDocs.length > 0 || openRows.some((r) => !o.status[r.key]);
        if (!rest) onFinished();
      }
    },
    onError: (e) => { toast.error(errorText(e)); onChanged(); },
  });

  // ---- Abschließen: offene Vorschläge verwerfen („Thema abgeschlossen“), dann das Thema
  const close = useMutation({
    mutationFn: async () => {
      for (const sid of topic.suggestionIds) await decideSuggestion(sid, "reject", { reason: "Thema abgeschlossen" });
      await decide.mutateAsync({ decision: "erledigt", silent: topic.suggestionIds.length > 0 });
      return topic.suggestionIds.length;
    },
    onSuccess: (k) => { if (k) toast.success("Thema abgeschlossen, offene Vorschläge verworfen."); onFinished(); },
    onError: (e) => { toast.error(errorText(e)); onChanged(); },
  });
  const busy = run.isPending || close.isPending || decide.isPending;
  const openHero = useHeroViewer();

  // ---- Mails, Antworten, Anhänge
  const target = targetOf(topic);
  const targetMail = newest(topic) ?? null;
  const draft = !!targetMail?.hasDraft;
  const replyHref = `/verfassen?reply=${target}&mode=reply${draft ? "&draft=1" : ""}`;
  // Mehrere Empfänger (An + CC): „Allen antworten“ (Absender + alle übrigen, ohne die eigenen Adressen)
  const replyAllHref = (targetMail?.recipientCount ?? 0) > 1 ? `/verfassen?reply=${target}&mode=replyAll` : null;
  const forwardHref = `/verfassen?reply=${target}&mode=forward`;
  const withAtt = [...topic.newMessages].reverse().find((m) => m.has_attachments);
  const heroTask = useQuery({
    queryKey: ["projects", "topic_task", topic.id], enabled: !!topic.projectId,
    queryFn: () => papi<{ task: HeroTaskInfo | null; heroId: number | null }>("topic_task", { threadId: topic.id }),
  });

  useStackKeys({
    onNext, onPrev, disabled: dialogOpen || busy,
    keys: {
      enter: () => { if (suggestions.length || openRows.length) { if (!blocked) run.mutate(); } },
      e: () => close.mutate(),
      r: () => nav(replyHref),
      a: () => { if (replyAllHref) nav(replyAllHref); },
      w: () => openDialog("later"),
      h: () => { if (topic.projectId) openHero(topic.projectId, topic.project?.nr); },
    },
  });

  // ---- Kopf
  const nr = topic.project?.nr ?? status.data?.nr ?? (topic.projectId ? `#${topic.projectId}` : null);
  const projName = topic.project?.name || status.data?.name || "";
  const createName = group.create ? (editsOf(group.create).name as string) : "";
  const actionBtn = "max-md:h-11";

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* 1. Projekt-Kopf */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectNr kind={kind} nr={nr} size="head" />
            {kind === "assigned" && topic.projectId && (
              <button type="button" onClick={() => openDialog("status")} title="Status in HERO ändern"
                className="touch-manipulation rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9">
                {status.isLoading ? "Status …" : status.data?.stepName ? clean(status.data.stepName) : "Status ändern"}
              </button>
            )}
            {topic.assignedTo && <span className="text-xs text-muted-foreground">bei {topic.assignedTo.name}</span>}
            {kind === "assigned" && topic.projectId && <HeroLink id={topic.projectId} label="In HERO öffnen" className="ml-auto" />}
          </div>
          {kind === "assigned" && (
            <>
              <h2 className="text-lg font-semibold">{projName || topic.subject}</h2>
              {topic.project?.kunde && <div className="text-sm text-muted-foreground">{topic.project.kunde}{topic.project.certain ? "" : " · vermutet"}</div>}
            </>
          )}
          {kind === "open" && (
            <>
              <h2 className="text-lg font-semibold">{choice === "new" || !chosen ? `Neues Projekt: ${createName || group.create?.payload?.project?.name || "(ohne Namen)"}` : `${chosen.nr} ${chosen.name}`.trim()}</h2>
              <div role="radiogroup" aria-label="Projekt" className="flex flex-wrap items-center gap-1.5 pt-1">
                {group.create && <Chip checked={choice === "new"} onClick={() => setChoice("new")}>Neu anlegen</Chip>}
                {cands.map((c) => <Chip key={c.id} checked={choice === c.id} onClick={() => setChoice(c.id)}>{c.nr} {c.name}</Chip>)}
                <button type="button" onClick={() => openDialog("assign")} className="touch-manipulation px-2 py-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Suchen</button>
              </div>
            </>
          )}
          {kind === "none" && (
            <>
              <h2 className="text-lg font-semibold">{topic.subject || "(ohne Betreff)"}</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{topic.from}</span>
                <Button variant="outline" size="sm" className="max-md:h-9" onClick={() => openDialog("assign")}>Projekt zuordnen</Button>
              </div>
            </>
          )}
        </div>

        {/* 2. Gelber Kasten */}
        <WhyBox topic={topic} onDropbox={(id) => openDialog("dropbox", id)} />

        {/* 3. HERO-Arbeitsmodus */}
        {heroTask.data?.task && topic.projectId && (
          <HeroTaskBox task={heroTask.data.task} heroId={heroTask.data.heroId ?? topic.projectId} nr={nr ?? `#${topic.projectId}`}
            onChanged={() => { ["projects", "topics", "suggestions", "overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }}
            onClosed={() => { ["projects", "topics", "suggestions", "overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onFinished(); }} />
        )}

        {/* 4. Vorschlag */}
        {(rows.length > 0 || Object.keys(finished).length > 0) && (
          <section aria-label="Vorschlag" className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vorschlag</h3>
            <ul className="space-y-1.5">
              {Object.entries(finished).filter(([k]) => !rows.some((r) => r.key === k)).sort((a, b) => a[1].rank - b[1].rank).map(([k, f]) => (
                <SuggestionRow key={k} id={k} text={f.text} checked={uiOf(k).checked} open={false} status={uiOf(k).status} reason={uiOf(k).reason} onChecked={() => {}} onToggle={() => {}} onReason={() => {}} />
              ))}
              {rows.map((r) => {
                const u = uiOf(r.key);
                const st: RowStatus = finished[r.key] ? u.status : "open";
                return (
                  <SuggestionRow key={r.key} id={r.key} text={r.text} checked={r.selectable ? u.checked : false} open={u.open} status={st} reason={u.reason} selectable={r.selectable}
                    onChecked={(v) => patch(r.key, { checked: v })} onReason={(v) => patch(r.key, { reason: v })}
                    onToggle={() => patch(r.key, { open: !u.open, ...(u.open ? {} : { checked: true }) })}>
                    {r.s && <FieldsFor s={r.s} edits={editsOf(r.s)} onChange={(e) => setEdits((all) => ({ ...all, [r.s!.id]: e }))} gewerke={gewerke} onDone={onChanged} />}
                    {r.mail && <p className="text-sm">Der Beleg „{r.mail.subject || "(ohne Betreff)"}“ geht mit „Ausführen“ an die Lexware-Belegadresse (Anhänge der Mail).</p>}
                  </SuggestionRow>
                );
              })}
            </ul>
          </section>
        )}

        {/* 5. Hauptknöpfe */}
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          {openRows.length > 0 && (
            <Button className={actionBtn} onClick={() => run.mutate()} disabled={busy || !!blocked}
              title={blocked ? "Erst oben ein Projekt wählen" : "Die angehakten Zeilen nacheinander ausführen, abgewählte verwerfen"}>
              {run.isPending && <Spinner />} Ausführen ({n}) <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] max-md:hidden">Enter</kbd>
            </Button>
          )}
          <Button className={actionBtn} variant={nothingOpen ? "default" : "outline"} onClick={() => close.mutate()} disabled={busy}
            title="Thema wird nicht weiter verfolgt – erst eine neue Mail legt es wieder vor">
            {close.isPending && <Spinner />} Abschließen <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] max-md:hidden">E</kbd>
          </Button>
          <Link to={replyHref} className={cn(buttonVariants({ variant: "outline" }), actionBtn)}>Antworten <kbd className="ml-1 rounded border px-1 text-[10px] max-md:hidden">R</kbd></Link>
          {replyAllHref && <Link to={replyAllHref} className={cn(buttonVariants({ variant: "outline" }), actionBtn)}>Allen antworten <kbd className="ml-1 rounded border px-1 text-[10px] max-md:hidden">A</kbd></Link>}
          <Button className={actionBtn} variant="outline" onClick={() => openDialog("later")} disabled={busy}>Später <kbd className="ml-1 rounded border px-1 text-[10px] max-md:hidden">W</kbd></Button>
        </div>

        {/* 6. Stille Zeile */}
        <div className="flex flex-wrap items-center gap-1 border-t pt-3">
          {topic.projectId && <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => openDialog("hero")}>In HERO erledigen …</Button>}
          <Link to={forwardHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-11")}>Weiterleiten</Link>
          <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => openDialog("else")}>Anders …</Button>
          {topic.projectId && <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => openDialog("assign")}>Anderes Projekt</Button>}
          <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => openDialog("user")}>Mitarbeiter</Button>
          {withAtt && <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => openDialog("dropbox", withAtt.id)}>In Dropbox</Button>}
        </div>

        {/* 7. Fußnote */}
        <p className="text-xs text-muted-foreground max-md:hidden">Tasten: J/K Thema, Enter ausführen, E abschließen, R antworten, A allen antworten, W später, H HERO.</p>
      </CardContent>
    </Card>
  );
}

function Chip({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onClick}
      className={cn("touch-manipulation rounded-full border px-3 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9",
        checked ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "bg-background")}>{children}</button>
  );
}

/** Felder je Vorschlagsart; „Prüfen & senden“ behält seinen eigenen Ablauf. */
function FieldsFor({ s, edits, onChange, gewerke, onDone }: { s: Suggestion; edits: Edits; onChange: (e: Edits) => void; gewerke: Gewerk[]; onDone: () => void }) {
  const p = { s, edits, onChange };
  switch (s.type) {
    case "link_project": return <LinkFields {...p} />;
    case "log_entry": return <LogFields {...p} />;
    case "change_step": return <StepFields {...p} />;
    case "create_project": return <ProjectFields {...p} gewerke={gewerke} />;
    case "upload_attachments": return <UploadFields {...p} />;
    case "prepare_offer": return <OfferFields {...p} />;
    case "create_confirmation": return <ConfirmationFields {...p} />;
    case "send_document": return <SendDocumentPanel s={s} onDone={onDone} />;
    default: return <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(s.payload, null, 2)}</pre>;
  }
}

// ------------------------------------------------------------------ Gelber Kasten
function WhyBox({ topic, onDropbox }: { topic: Topic; onDropbox: (messageId: string) => void }) {
  const mails = topic.newMessages;
  const last = mails[mails.length - 1];
  const others = mails.slice(0, -1).reverse();
  const [more, setMore] = useState(false);
  const reason = topic.reasonText || (topic.reason ? TOPIC_REASON_LABELS[topic.reason] : "");
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <b>{reason || "Zu entscheiden"}</b>
        {last && <span className="text-xs opacity-80">{last.from_name || last.from_addr} · {formatDateTime(last.sent_at)}</span>}
      </div>
      {topic.reason === "wiedervorlage" && (topic.snoozedUntil || topic.note) && (
        <p className="text-xs">{topic.snoozedUntil && <>fällig seit {formatDate(topic.snoozedUntil)}</>}{topic.note && <> · „{topic.note}“</>}</p>
      )}
      {last ? <MailLine m={last} onDropbox={onDropbox} /> : topic.lastMail && (
        <LastMailLine topic={topic} />
      )}
      {others.length > 0 && (
        <div className="space-y-2">
          <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="touch-manipulation text-xs underline underline-offset-2 hover:no-underline max-md:min-h-9">
            {more ? "Weitere Mails zuklappen" : `+ ${others.length} weitere neue ${others.length === 1 ? "Mail" : "Mails"}`}
          </button>
          {more && others.map((m) => (
            <div key={m.id} className="space-y-1 border-t border-amber-300/70 pt-2 dark:border-amber-800">
              <div className="text-xs opacity-80">{m.from_name || m.from_addr} · {formatDateTime(m.sent_at)}</div>
              <MailLine m={m} onDropbox={onDropbox} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Keine neue Mail (z. B. Wiedervorlage): die letzte Mail des Themas – lesen und öffnen wie bei neuen Mails. */
function LastMailLine({ topic }: { topic: Topic }) {
  const [open, setOpen] = useState(false);
  const lm = topic.lastMail!;
  const id = topic.latestId;
  return (
    <div className="space-y-1.5">
      <p className="line-clamp-2 md:line-clamp-1">
        <span className="text-xs opacity-80">Zuletzt {lm.direction === "out" ? "wir" : lm.from}, {formatDateTime(lm.sent_at)}: </span>
        {lm.summary || "(ohne Inhalt)"}
      </p>
      {id && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="touch-manipulation underline underline-offset-2 hover:no-underline max-md:min-h-9">{open ? "Mail zuklappen" : "Mail lesen"}</button>
          <Link to={`/mails/${id}`} className="underline underline-offset-2 hover:no-underline">Ganze Mail öffnen</Link>
        </div>
      )}
      {open && id && <div className="rounded-md border bg-background p-2 text-foreground"><MailBody messageId={id} fallbackText={null} /></div>}
    </div>
  );
}

/** Zusammenfassung einer Mail, darunter „Mail lesen“ · „Ganze Mail öffnen“ · Anhänge. */
function MailLine({ m, onDropbox }: { m: TopicMail; onDropbox: (messageId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="line-clamp-2 md:line-clamp-1" title={m.summary ?? undefined}>{m.summary || m.subject || "(ohne Betreff)"}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="touch-manipulation underline underline-offset-2 hover:no-underline max-md:min-h-9">{open ? "Mail zuklappen" : "Mail lesen"}</button>
        <Link to={`/mails/${m.id}`} className="underline underline-offset-2 hover:no-underline">Ganze Mail öffnen</Link>
        {m.has_attachments && <button type="button" onClick={() => onDropbox(m.id)} className="inline-flex touch-manipulation items-center gap-1 underline underline-offset-2 hover:no-underline max-md:min-h-9"><FolderInput className="h-3.5 w-3.5" aria-hidden /> In Dropbox</button>}
      </div>
      {!!m.attachments?.length && <AttachmentLinks items={m.attachments} />}
      {open && <div className="rounded-md border bg-background p-2 text-foreground"><MailBody messageId={m.id} fallbackText={null} /></div>}
    </div>
  );
}

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Anhänge zum Öffnen (neuer Tab); Bilder als Vorschaubild. Links gelten 10 Minuten, danach Seite neu laden. */
function AttachmentLinks({ items }: { items: NonNullable<TopicMail["attachments"]> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((a) => a.url ? (
        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" title={`${a.filename} öffnen`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent">
          {/^image\//.test(a.mime) ? <img src={a.url} alt="" className="h-8 w-8 rounded object-cover" /> : <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{a.filename}</span><span className="shrink-0 text-muted-foreground">{kb(a.size)}</span>
        </a>
      ) : (
        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground" title="Nicht gespeichert (zu groß) – im Postfach öffnen">
          <Paperclip className="h-3.5 w-3.5" aria-hidden /> {a.filename}
        </span>
      ))}
    </div>
  );
}

