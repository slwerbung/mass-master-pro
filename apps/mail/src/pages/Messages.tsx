import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Calendar, Forward, GraduationCap, Inbox, Mail, Paperclip, PenLine, RefreshCw, Reply, Search, Send, Tag, Trash2, Undo2, X,
} from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import type { Account, MessageRow } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/shared";
import { Badge, Button, ErrorBox, Input, Spinner } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { FilterMenu } from "@/components/FilterMenu";
import { cn, errorText, formatDateTime, pct } from "@/lib/utils";

const PAGE = 50;
const STATUS_LABELS: Record<string, string> = {
  neu: "Neu", klassifiziert: "Verstanden", zugeordnet: "Zugeordnet", ohne_bezug: "Ohne Bezug", erledigt: "Erledigt", wartet: "Wartet auf Freigabe", fehler: "Fehler",
};
const BELEG_LABELS: Record<string, string> = {
  portal_offen: "Im Portal abzuholen", portal_erledigt: "Portal: abgeholt", weiterleiten_offen: "Zum Weiterleiten vorgemerkt", weitergeleitet: "An Lexware weitergeleitet",
};

/** Schnellansichten – die Server-Seite (email-api `VIEWS`) kennt dieselben Schluessel. */
const VIEWS: { key: string; label: string; hint: string }[] = [
  { key: "", label: "Alle", hint: "Alle Mails" },
  { key: "kunden", label: "Kundenmails", hint: "Eingehend: Anfragen, Projekt-Kommunikation, Freigaben, Aufträge, Reklamationen" },
  { key: "ohne_projekt", label: "Ohne Projekt", hint: "Kundenmails, die keinem HERO-Projekt zugeordnet sind" },
  { key: "unsicher", label: "Unsicher", hint: "Die KI war sich unter 70 % sicher – lohnt einen Blick" },
  { key: "belege", label: "Belege", hint: "Rechnungen, Gutschriften, Zahlungsavis" },
  { key: "korrigiert", label: "Korrigiert", hint: "Mails mit einer Korrektur von dir" },
  { key: "fehler", label: "Fehler", hint: "Verarbeitung fehlgeschlagen" },
  { key: "papierkorb", label: "Papierkorb", hint: "In den Papierkorb des Postfachs verschoben" },
];

const PERIODS: { key: string; label: string; days?: number }[] = [
  { key: "heute", label: "Heute", days: 0 }, { key: "7", label: "Letzte 7 Tage", days: 7 },
  { key: "30", label: "Letzte 30 Tage", days: 30 }, { key: "90", label: "Letzte 90 Tage", days: 90 }, { key: "eigen", label: "Eigener Zeitraum" },
];

const isoDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

export default function Messages() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const g = (k: string) => sp.get(k) ?? "";
  const f = {
    q: g("q"), view: g("view"), category: g("category"), accountId: g("accountId"), status: g("status"), hero: g("hero"),
    direction: g("direction"), belegState: g("belegState"), attachments: g("attachments"), zeit: g("zeit"), from: g("from"), to: g("to"),
  };
  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    setSp(n, { replace: true });
    setPage(0);
  };
  const set = (k: string, v: string) => update({ [k]: v });

  // Suche entprellt: nicht bei jedem Tastendruck eine Abfrage.
  const [qText, setQText] = useState(f.q);
  useEffect(() => { setQText(f.q); }, [f.q]);
  useEffect(() => {
    if (qText === f.q) return;
    const t = setTimeout(() => set("q", qText.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qText]);

  // Zeitraum: Voreinstellung -> von/bis
  const period = PERIODS.find((p) => p.key === f.zeit);
  const range = (() => {
    if (f.zeit === "eigen") return { from: f.from, to: f.to ? `${f.to}T23:59:59` : "" };
    if (period?.days == null) return { from: "", to: "" };
    const d = new Date(); d.setDate(d.getDate() - period.days);
    return { from: isoDay(d), to: "" };
  })();
  const query = { ...f, from: range.from, to: range.to, zeit: undefined };
  const queryKey = JSON.stringify(query);
  // Auswahl gilt fuer die aktuelle Liste: bei anderen Filtern oder Seiten neu anfangen.
  useEffect(() => { setSelected(new Set()); }, [queryKey, page]);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("list_accounts") });
  const list = useQuery({
    queryKey: ["messages", query, page],
    queryFn: () => api<{ messages: MessageRow[]; total: number }>("list_messages", { ...query, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const facetQuery = { ...query, category: "" };
  const facets = useQuery({
    queryKey: ["messages", "facets", facetQuery],
    queryFn: () => api<{ categories: Record<string, number> }>("message_facets", facetQuery),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const total = list.data?.total ?? 0;
  const rows = list.data?.messages ?? [];
  const counts = facets.data?.categories ?? {};
  const accountLabel = new Map((accounts.data ?? []).map((a) => [a.id, a.label]));
  const multiAccount = (accounts.data?.length ?? 0) > 1;
  const inTrash = f.view === "papierkorb";
  const title = inTrash ? "Papierkorb"
    : f.category ? CATEGORY_LABELS[f.category as Category] ?? f.category
    : f.direction === "out" ? "Gesendet" : f.direction === "in" ? "Posteingang" : "Alle Mails";
  const activeFilters = ["q", "category", "accountId", "status", "hero", "direction", "belegState", "attachments", "zeit"].filter((k) => f[k as keyof typeof f]).length;
  const resetAll = () => { setSp(new URLSearchParams(f.view ? { view: f.view } : {}), { replace: true }); setQText(""); setPage(0); };

  // ---------------------------------------------------------------- Auswahl und Sammelaktionen
  const allOnPage = rows.length > 0 && rows.every((m) => selected.has(m.id));
  const someOnPage = rows.some((m) => selected.has(m.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((m) => m.id)));
  const ids = useMemo(() => [...selected], [selected]);
  const refresh = () => { ["messages", "overview", "suggestions", "digest"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setSelected(new Set()); };

  const mailbox = useMutation({
    mutationFn: (action: "trash" | "restore") => invokeFn<{ moved: number; notInMailbox: number; errors: string[] }>("email-mailbox", { action, ids }),
    onSuccess: (r, action) => {
      const n = r.moved + r.notInMailbox;
      if (n) toast.success(action === "trash" ? `${n} Mail(s) in den Papierkorb verschoben.` : `${n} Mail(s) wiederhergestellt.`);
      if (r.notInMailbox) toast(`${r.notInMailbox} davon waren im Postfach schon nicht mehr da – nur in der App ${action === "trash" ? "ausgeblendet" : "wieder eingeblendet"}.`);
      r.errors.forEach((e) => toast.error(e));
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const bulk = useMutation({
    mutationFn: (p: { op: "category"; category: Category } | { op: "reprocess" }) => api<{ changed: number; learned?: string[] }>("bulk_messages", { ids, ...p }),
    onSuccess: (r, p) => {
      toast.success(p.op === "reprocess" ? `${r.changed} Mail(s) werden neu verarbeitet.` : `Kategorie bei ${r.changed} Mail(s) geändert – der Assistent lernt daraus.`);
      if (r.learned?.length) toast(`Neue Absenderregel(n): ${r.learned.join(", ")}`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const busy = mailbox.isPending || bulk.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {list.data && <span className="text-sm text-muted-foreground">{total.toLocaleString("de-DE")} Treffer</span>}
        {list.isFetching && <Spinner />}
      </div>

      {/* Ansichten als Reiter */}
      <div className="-mx-1 overflow-x-auto border-b px-1">
        <div className="flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.key} type="button" title={v.hint} onClick={() => set("view", v.key)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                f.view === v.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                v.key === "papierkorb" && "ml-auto",
              )}
            >
              {v.key === "papierkorb" && <Trash2 className="h-3.5 w-3.5" />}{v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Suche und Filter in einer Leiste */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 rounded-full pl-8 pr-8" placeholder="Suchen …" value={qText} onChange={(e) => setQText(e.target.value)} />
          {qText && (
            <button type="button" aria-label="Suche leeren" className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground" onClick={() => { setQText(""); set("q", ""); }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <FilterMenu
          label="Kategorie" icon={<Tag className="h-3.5 w-3.5" />} value={f.category} onChange={(v) => set("category", v)}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c], count: counts[c] ?? 0 })).filter((o) => o.count || o.value === f.category)}
        />
        <FilterMenu
          label="Zeitraum" icon={<Calendar className="h-3.5 w-3.5" />}
          value={f.zeit === "eigen" ? (f.from || f.to ? `${f.from || "…"} – ${f.to || "heute"}` : "Eigener Zeitraum") : period?.label ?? ""}
          onChange={() => update({ zeit: "", from: "", to: "" })}
        >
          {(close) => (
            <div className="space-y-1">
              {PERIODS.filter((p) => p.key !== "eigen").map((p) => (
                <button key={p.key} type="button" onClick={() => { update({ zeit: p.key, from: "", to: "" }); close(); }}
                  className={cn("block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", f.zeit === p.key && "font-medium")}>{p.label}</button>
              ))}
              <div className="space-y-1 border-t px-2 pb-1 pt-2">
                <div className="text-xs text-muted-foreground">Eigener Zeitraum</div>
                <div className="flex gap-1">
                  <Input type="date" aria-label="Von" className="h-8" value={f.from} onChange={(e) => update({ zeit: "eigen", from: e.target.value })} />
                  <Input type="date" aria-label="Bis" className="h-8" value={f.to} onChange={(e) => update({ zeit: "eigen", to: e.target.value })} />
                </div>
              </div>
            </div>
          )}
        </FilterMenu>
        {multiAccount && (
          <FilterMenu label="Postfach" icon={<Inbox className="h-3.5 w-3.5" />} value={f.accountId} onChange={(v) => set("accountId", v)}
            options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.label }))} />
        )}
        <FilterMenu label="Status" value={f.status} onChange={(v) => set("status", v)} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterMenu label="HERO" value={f.hero} onChange={(v) => set("hero", v)} options={[{ value: "mit", label: "Mit Projekt" }, { value: "ohne", label: "Ohne Projekt" }]} />
        <FilterMenu label="Richtung" value={f.direction} onChange={(v) => set("direction", v)} options={[{ value: "in", label: "Eingehend" }, { value: "out", label: "Ausgehend" }]} />
        <FilterMenu label="Belege" value={f.belegState} onChange={(v) => set("belegState", v)} options={Object.entries(BELEG_LABELS).map(([value, label]) => ({ value, label }))} />
        <button
          type="button" onClick={() => set("attachments", f.attachments ? "" : "ja")}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm", f.attachments ? "border-primary/40 bg-primary/10 font-medium text-primary" : "bg-background hover:bg-accent")}
        >
          <Paperclip className="h-3.5 w-3.5" /> Mit Anhang
        </button>
        {activeFilters > 0 && <button type="button" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={resetAll}>Zurücksetzen</button>}
      </div>

      <ErrorBox error={list.error} />

      <div className={cn("rounded-lg border bg-card transition-opacity", list.isPlaceholderData && "opacity-60")}>
        {/* Kopfzeile: alle auswählen bzw. Sammelaktionen */}
        <div className={cn("sticky top-0 z-20 flex min-h-11 flex-wrap items-center gap-2 rounded-t-lg border-b px-3 py-1.5 text-sm", someOnPage ? "bg-primary/5" : "bg-muted/40")}>
          <input
            type="checkbox" className="h-4 w-4" aria-label="Alle auf dieser Seite auswählen" checked={allOnPage}
            ref={(el) => { if (el) el.indeterminate = someOnPage && !allOnPage; }} onChange={toggleAll} disabled={!rows.length}
          />
          {selected.size ? (
            <>
              <span className="font-medium">{selected.size} ausgewählt</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {!inTrash && (
                  <>
                    <FilterMenu align="right" label="Kategorie setzen" icon={<Tag className="h-3.5 w-3.5" />} value="" onChange={(v) => v && bulk.mutate({ op: "category", category: v as Category })}
                      options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
                    <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => bulk.mutate({ op: "reprocess" })}>
                      <RefreshCw className="h-3.5 w-3.5" /> Neu verarbeiten
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-full border-red-200 text-red-700 hover:bg-red-50" disabled={busy}
                      onClick={() => { if (confirm(`${selected.size} Mail(s) in den Papierkorb des Postfachs verschieben?`)) mailbox.mutate("trash"); }}>
                      {mailbox.isPending ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />} Löschen
                    </Button>
                  </>
                )}
                {inTrash && (
                  <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => mailbox.mutate("restore")}>
                    {mailbox.isPending ? <Spinner /> : <Undo2 className="h-3.5 w-3.5" />} Wiederherstellen
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setSelected(new Set())}>Auswahl aufheben</Button>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">{rows.length ? "Auswählen für Sammelaktionen" : ""}</span>
          )}
        </div>

        <div className="divide-y">
          {rows.map((m) => {
            const on = selected.has(m.id);
            return (
              <div key={m.id} className={cn("group flex items-start gap-3 px-3 py-2.5 hover:bg-accent/40", on && "bg-primary/5")}>
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={on} onChange={() => toggle(m.id)} aria-label={`${m.subject || "Mail"} auswählen`} />
                <Link to={`/mails/${m.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.direction === "out" ? <Send className="h-4 w-4 text-muted-foreground" aria-label="Ausgehend" />
                      : m.answered_at ? <span title={`Beantwortet am ${formatDateTime(m.answered_at)}`}><Reply className="h-4 w-4 text-primary" aria-label="Beantwortet" /></span>
                      : <Mail className="h-4 w-4 text-muted-foreground" aria-label="Eingehend" />}
                    {m.user_forwarded_at && <span title={`Weitergeleitet am ${formatDateTime(m.user_forwarded_at)}`}><Forward className="h-4 w-4 text-primary" aria-label="Weitergeleitet" /></span>}
                    <span className="font-medium">{m.from_name || m.from_addr}</span>
                    <CategoryChip category={m.category} />
                    {m.confidence != null && m.confidence < 0.7 && <Badge variant="warn">unsicher {pct(m.confidence)}</Badge>}
                    {m.beleg_state === "portal_offen" && <Badge variant="warn">Portal{m.beleg_vendor ? `: ${m.beleg_vendor}` : ""}</Badge>}
                    {m.hero_project_match_id && <Badge variant="outline">HERO #{m.hero_project_match_id}</Badge>}
                    {m.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-label="Anhänge" />}
                    {m.draft_message_id && <PenLine className="h-3.5 w-3.5 text-muted-foreground" aria-label="Entwurf" />}
                    {m.correction_note && <GraduationCap className="h-3.5 w-3.5 text-amber-700" aria-label="Von dir korrigiert" />}
                    {m.status === "fehler" && <Badge variant="danger">Fehler</Badge>}
                    {m.status === "wartet" && <Badge variant="warn">Freigabe offen</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {multiAccount && accountLabel.get(m.account_id) ? `${accountLabel.get(m.account_id)} · ` : ""}{formatDateTime(m.sent_at)}
                    </span>
                  </div>
                  <div className="truncate text-sm">{m.subject || "(ohne Betreff)"}</div>
                  {m.summary && <div className="truncate text-xs text-muted-foreground">{m.summary}</div>}
                </Link>
              </div>
            );
          })}
          {list.data && !rows.length && (
            <div className="space-y-2 p-8 text-center text-sm text-muted-foreground">
              <p>{inTrash ? "Der Papierkorb ist leer." : "Keine Mails gefunden."}</p>
              {activeFilters > 0 && <Button variant="outline" size="sm" onClick={resetAll}>Filter zurücksetzen</Button>}
            </div>
          )}
          {list.isLoading && <div className="p-6"><Spinner /></div>}
        </div>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} von {total.toLocaleString("de-DE")}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Weiter</Button>
          </div>
        </div>
      )}
    </div>
  );
}
