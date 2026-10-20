import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { GraduationCap, Mail, Paperclip, PenLine, Search, Send, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Account, MessageRow } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/shared";
import { Badge, Button, ErrorBox, Field, Input, Select, Spinner } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { cn, formatDateTime, pct } from "@/lib/utils";

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
];

const PERIODS: { key: string; label: string; days?: number }[] = [
  { key: "", label: "Gesamter Zeitraum" }, { key: "heute", label: "Heute", days: 0 }, { key: "7", label: "Letzte 7 Tage", days: 7 },
  { key: "30", label: "Letzte 30 Tage", days: 30 }, { key: "90", label: "Letzte 90 Tage", days: 90 }, { key: "eigen", label: "Eigener Zeitraum …" },
];

const isoDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

/** Filter, die im Panel „Weitere Filter" stehen (Ansicht, Kategorie und Suche liegen sichtbar oben). */
const PANEL_KEYS = ["accountId", "status", "hero", "direction", "belegState", "attachments", "zeit"] as const;

export default function Messages() {
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(0);
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

  const panelCount = PANEL_KEYS.filter((k) => f[k]).length;
  const [panel, setPanel] = useState(panelCount > 0);

  // Zeitraum: Voreinstellung -> von/bis
  const period = PERIODS.find((p) => p.key === f.zeit);
  const range = (() => {
    if (f.zeit === "eigen") return { from: f.from, to: f.to ? `${f.to}T23:59:59` : "" };
    if (period?.days == null) return { from: "", to: "" };
    const d = new Date(); d.setDate(d.getDate() - period.days);
    return { from: isoDay(d), to: "" };
  })();
  const query = { ...f, from: range.from, to: range.to, zeit: undefined };

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
  const counts = facets.data?.categories ?? {};
  const accountLabel = new Map((accounts.data ?? []).map((a) => [a.id, a.label]));
  const multiAccount = (accounts.data?.length ?? 0) > 1;

  // Aktive Filter als entfernbare Kaertchen
  const pills: { label: string; clear: Record<string, string> }[] = [];
  if (f.q) pills.push({ label: `„${f.q}“`, clear: { q: "" } });
  if (f.category) pills.push({ label: CATEGORY_LABELS[f.category as Category] ?? f.category, clear: { category: "" } });
  if (f.accountId) pills.push({ label: `Postfach: ${accountLabel.get(f.accountId) ?? "?"}`, clear: { accountId: "" } });
  if (f.status) pills.push({ label: `Status: ${STATUS_LABELS[f.status] ?? f.status}`, clear: { status: "" } });
  if (f.hero) pills.push({ label: f.hero === "mit" ? "Mit HERO-Projekt" : "Ohne HERO-Projekt", clear: { hero: "" } });
  if (f.direction) pills.push({ label: f.direction === "in" ? "Eingehend" : "Ausgehend", clear: { direction: "" } });
  if (f.belegState) pills.push({ label: BELEG_LABELS[f.belegState] ?? f.belegState, clear: { belegState: "" } });
  if (f.attachments) pills.push({ label: "Mit Anhang", clear: { attachments: "" } });
  if (f.zeit) {
    const label = f.zeit === "eigen" ? `${f.from || "…"} bis ${f.to || "heute"}` : period?.label ?? f.zeit;
    pills.push({ label, clear: { zeit: "", from: "", to: "" } });
  }
  const resetAll = () => { setSp(new URLSearchParams(f.view ? { view: f.view } : {}), { replace: true }); setQText(""); setPage(0); };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Alle Mails</h1>
        {list.data && <span className="text-sm text-muted-foreground">{total.toLocaleString("de-DE")} Treffer</span>}
        {list.isFetching && <Spinner />}
      </div>

      {/* Ansichten */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key} type="button" title={v.hint} onClick={() => set("view", v.key)}
              className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm", f.view === v.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >{v.label}</button>
          ))}
        </div>
      </div>

      {/* Suche + weitere Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 pr-8" placeholder="Suchen in Betreff, Absender, Zusammenfassung" value={qText} onChange={(e) => setQText(e.target.value)} />
          {qText && (
            <button type="button" aria-label="Suche leeren" className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => { setQText(""); set("q", ""); }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button variant={panel ? "secondary" : "outline"} onClick={() => setPanel(!panel)} aria-expanded={panel}>
          <SlidersHorizontal className="h-4 w-4" /> Filter{panelCount ? <Badge className="ml-1">{panelCount}</Badge> : null}
        </Button>
      </div>

      {panel && (
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {multiAccount && (
            <Field label="Postfach">
              <Select value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>
                <option value="">Alle Postfächer</option>
                {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Zeitraum">
            <Select value={f.zeit} onChange={(e) => update({ zeit: e.target.value, ...(e.target.value !== "eigen" ? { from: "", to: "" } : {}) })}>
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </Field>
          {f.zeit === "eigen" && (
            <Field label="Von – bis">
              <div className="flex gap-2">
                <Input type="date" aria-label="Von" value={f.from} onChange={(e) => set("from", e.target.value)} />
                <Input type="date" aria-label="Bis" value={f.to} onChange={(e) => set("to", e.target.value)} />
              </div>
            </Field>
          )}
          <Field label="Status">
            <Select value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">Alle</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="HERO-Projekt">
            <Select value={f.hero} onChange={(e) => set("hero", e.target.value)}>
              <option value="">Egal</option>
              <option value="mit">Zugeordnet</option>
              <option value="ohne">Nicht zugeordnet</option>
            </Select>
          </Field>
          <Field label="Richtung">
            <Select value={f.direction} onChange={(e) => set("direction", e.target.value)}>
              <option value="">Ein- und ausgehend</option>
              <option value="in">Eingehend</option>
              <option value="out">Ausgehend</option>
            </Select>
          </Field>
          <Field label="Belege">
            <Select value={f.belegState} onChange={(e) => set("belegState", e.target.value)}>
              <option value="">Alle</option>
              {Object.entries(BELEG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Anhänge">
            <Select value={f.attachments} onChange={(e) => set("attachments", e.target.value)}>
              <option value="">Egal</option>
              <option value="ja">Nur mit Anhang</option>
            </Select>
          </Field>
        </div>
      )}

      {/* Kategorien mit Anzahl unter den uebrigen Filtern */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.filter((c) => counts[c] || f.category === c).map((c) => {
          const on = f.category === c;
          return (
            <button
              key={c} type="button" onClick={() => set("category", on ? "" : c)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
            >
              {CATEGORY_LABELS[c]}
              <span className={cn("tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>{counts[c] ?? 0}</span>
            </button>
          );
        })}
        {facets.data && !CATEGORIES.some((c) => counts[c]) && !f.category && <span className="text-xs text-muted-foreground">Keine Kategorien in dieser Auswahl.</span>}
      </div>

      {pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {pills.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
              {p.label}
              <button type="button" aria-label={`${p.label} entfernen`} onClick={() => { update(p.clear); if ("q" in p.clear) setQText(""); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" className="ml-1 text-muted-foreground underline hover:text-foreground" onClick={resetAll}>Alle zurücksetzen</button>
        </div>
      )}

      <ErrorBox error={list.error} />

      <div className={cn("divide-y rounded-lg border bg-card transition-opacity", list.isPlaceholderData && "opacity-60")}>
        {list.data?.messages.map((m) => (
          <Link key={m.id} to={`/mails/${m.id}`} className="flex flex-col gap-1 p-3 hover:bg-accent/50">
            <div className="flex flex-wrap items-center gap-2">
              {m.direction === "out" ? <Send className="h-4 w-4 text-muted-foreground" aria-label="Ausgehend" /> : <Mail className="h-4 w-4 text-muted-foreground" aria-label="Eingehend" />}
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
        ))}
        {list.data && !list.data.messages.length && (
          <div className="space-y-2 p-6 text-sm text-muted-foreground">
            <p>Keine Mails gefunden.</p>
            {(pills.length > 0 || f.view) && <Button variant="outline" size="sm" onClick={() => { setSp(new URLSearchParams(), { replace: true }); setQText(""); setPage(0); }}>Filter zurücksetzen</Button>}
          </div>
        )}
        {list.isLoading && <div className="p-6"><Spinner /></div>}
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
