import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Archive, RefreshCw } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { CATEGORY_NAMES, CATEGORY_STYLE, papi, tageText, type FollowupItem, type ProjectCard, type ProjectDetail, type ProjectList, type ProjectOverview, type ProjectView } from "@/lib/projects";
import { Badge, Button, Card, CardContent, ErrorBox, Field, Input, Spinner } from "@/components/ui";
import { HeroLink, heroProjectUrl } from "@/components/HeroLink";
import { cn, errorText } from "@/lib/utils";

const QK = ["projects"];
type View = "stapel" | "wiedervorlagen";

export default function Projects() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("stapel");
  const [sel, setSel] = useState<string | null>(null); // Karten-ID oder "cleanup"
  const [snoozeFor, setSnoozeFor] = useState<ProjectCard | null>(null);

  const overview = useQuery({ queryKey: [...QK, "overview"], queryFn: () => papi<ProjectOverview>("overview"), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: [...QK, "list"], queryFn: () => papi<ProjectList>("list"), refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: QK });

  const sync = useMutation({
    mutationFn: () => invokeFn<{ sync: { fetched: number; kept: number }; evaluate: { cards: number } }>("hero-sync", {}),
    onSuccess: (r) => { toast.success(`${r.sync.kept} offene Projekte geladen, ${r.evaluate.cards} Karten.`); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const wake = useMutation({
    mutationFn: (id: string) => papi("wake", { followupId: id }),
    onSuccess: () => { toast.success("Karte ist wieder im Stapel."); setView("stapel"); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });

  const stack = list.data?.stack ?? [];
  const cleanup = list.data?.cleanup ?? [];
  const selected = stack.find((c) => c.id === sel) ?? null;
  const showCleanup = sel === "cleanup";

  // Ohne Auswahl (oder nach einer Aktion) die erste Karte zeigen.
  useEffect(() => {
    if (view !== "stapel" || !list.data) return;
    if (sel === "cleanup" && cleanup.length) return;
    if (!stack.some((c) => c.id === sel)) setSel(stack[0]?.id ?? (cleanup.length ? "cleanup" : null));
  }, [list.data, sel, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (d: 1 | -1) => {
    const i = stack.findIndex((c) => c.id === sel);
    const n = stack[Math.min(Math.max(i + d, 0), stack.length - 1)];
    if (n) setSel(n.id);
  };

  // Tastatur: J/K naechste/vorige, W Wiedervorlage, H In HERO. (E/A/S/Enter folgen mit den scharfen Aktionen.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (snoozeFor || e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || view !== "stapel") return;
      const k = e.key.toLowerCase();
      if (k === "j") step(1);
      else if (k === "k") step(-1);
      else if (k === "w" && selected) setSnoozeFor(selected);
      else if (k === "h" && selected) window.open(heroProjectUrl(selected.project.heroId), "_blank", "noopener");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const o = overview.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Projekte</h1>
        {o?.shadow && <Badge variant="warn" title="Es wird nichts nach HERO geschrieben und keine Mail versendet.">Schattenmodus</Badge>}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {o?.lastSync && <span title={o.lastSync.error ?? ""}>{o.lastSync.ok ? "Stand" : "Sync-Fehler"}: {new Date(o.lastSync.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
          <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending} title="HERO jetzt abfragen und Regeln anwenden">
            <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} /> Jetzt abgleichen
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {([["stapel", `Stapel${o ? ` (${o.cards + o.cleanup})` : ""}`], ["wiedervorlagen", `Wiedervorlagen${o ? ` (${o.followups})` : ""}`]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", view === v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>
        ))}
      </div>

      {list.isLoading && <Spinner />}
      <ErrorBox error={list.error} />
      {sync.isError && o?.lastSync?.ok === false && <ErrorBox error={o.lastSync.error} />}

      {list.data && view === "wiedervorlagen" && (
        <Followups items={list.data.followups} onWake={(id) => wake.mutate(id)} busy={wake.isPending} />
      )}

      {list.data && view === "stapel" && (
        <div className="grid gap-4 md:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {!stack.length && !cleanup.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">Nichts zu tun – kein Projekt braucht gerade eine Entscheidung. 🎉</p>}
            {stack.map((c) => <StackItem key={c.id} card={c} active={c.id === sel} onClick={() => setSel(c.id)} />)}
            {cleanup.length > 0 && (
              <button type="button" onClick={() => setSel("cleanup")}
                className={cn("flex w-full items-center gap-2 rounded-md border border-dashed p-3 text-left text-sm hover:bg-accent", showCleanup && "bg-accent")}>
                <Archive className="h-4 w-4 shrink-0" />
                <span><b>{cleanup.length}</b> Projekte seit über {list.data.bundleAfterDays} Tagen ohne Bewegung</span>
              </button>
            )}
          </div>
          <div className="min-w-0">
            {selected && <CardPane key={selected.id} card={selected} onSnooze={() => setSnoozeFor(selected)} />}
            {showCleanup && <CleanupPane items={cleanup} days={list.data.bundleAfterDays} />}
          </div>
        </div>
      )}

      {snoozeFor && (
        <SnoozeDialog card={snoozeFor} onClose={() => setSnoozeFor(null)}
          onDone={() => { const i = stack.findIndex((c) => c.id === snoozeFor.id); setSel(stack[i + 1]?.id ?? stack[i - 1]?.id ?? null); setSnoozeFor(null); refresh(); }} />
      )}
    </div>
  );
}

function CategoryTag({ c }: { c: ProjectCard["category"] }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", CATEGORY_STYLE[c])}>{CATEGORY_NAMES[c]}</span>;
}

function StackItem({ card, active, onClick }: { card: ProjectCard; active: boolean; onClick: () => void }) {
  const p = card.project;
  return (
    <button type="button" onClick={onClick} className={cn("w-full rounded-md border p-3 text-left hover:bg-accent", active && "border-primary bg-accent")}>
      <div className="flex items-center gap-2">
        <CategoryTag c={card.category} />
        <span className="text-xs text-muted-foreground">{p.nr}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{tageText(card.reasons.days ?? p.days)}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{p.name || "(ohne Namen)"}</div>
      <div className="truncate text-xs text-muted-foreground">{p.kunde || "Kunde unbekannt"} · {card.suggestion || card.ruleLabel}</div>
    </button>
  );
}

function CardPane({ card, onSnooze }: { card: ProjectCard; onSnooze: () => void }) {
  const p = card.project;
  const detail = useQuery({ queryKey: [...QK, "detail", p.heroId], queryFn: () => papi<ProjectDetail>("detail", { heroId: p.heroId }) });
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{p.nr}</span>
            {p.gewerk && <Badge variant="secondary">{p.gewerk}</Badge>}
            {p.assignees.length > 0 && <span>{p.assignees.join(", ")}</span>}
          </div>
          <h2 className="mt-1 text-lg font-semibold">{p.name || "(ohne Namen)"}</h2>
          <div className="text-sm text-muted-foreground">{p.kunde || "Kunde unbekannt"}{p.ort ? ` · ${p.ort}` : ""}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{p.stepName.replace(/^[^\p{L}\p{N}]+/u, "")}</Badge>
            <span className="text-muted-foreground">seit {tageText(p.days)}</span>
          </div>
        </div>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide">Warum jetzt</div>
          {card.reasons.text || card.ruleLabel}
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zuletzt</div>
          {detail.isLoading && <Spinner />}
          <ErrorBox error={detail.error} />
          <ul className="space-y-1 text-sm">
            {detail.data?.events.map((e, i) => (
              <li key={i} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-muted-foreground">{new Date(e.at).toLocaleDateString("de-DE")}</span><span>{e.text}</span></li>
            ))}
            {detail.data && !detail.data.events.length && <li className="text-muted-foreground">Keine Ereignisse.</li>}
          </ul>
          {detail.data && <p className="mt-2 text-xs text-muted-foreground">{detail.data.summary}</p>}
        </div>

        {card.suggestion && <p className="text-sm"><span className="text-muted-foreground">Vorschlag:</span> <b>{card.suggestion}</b></p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onSnooze}><AlarmClock className="h-4 w-4" /> Wiedervorlage <kbd className="ml-1 rounded border px-1 text-[10px]">W</kbd></Button>
          <Button variant="outline" onClick={() => window.open(heroProjectUrl(p.heroId), "_blank", "noopener")}>In HERO öffnen <kbd className="ml-1 rounded border px-1 text-[10px]">H</kbd></Button>
        </div>
        <p className="text-xs text-muted-foreground">Schattenmodus: Abschließen, Statuswechsel, Notizen und Termine in HERO folgen mit „Aktionen scharf“. Tasten: J/K nächste/vorige Karte.</p>
      </CardContent>
    </Card>
  );
}

function CleanupPane({ items, days }: { items: ProjectCard[]; days: number }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h2 className="text-lg font-semibold">{items.length} Projekte seit über {days} Tagen ohne Bewegung</h2>
        <p className="text-sm text-muted-foreground">Diese Projekte stehen nicht einzeln im Stapel. Das Aufräumen (einzeln abwählen, „Alle archivieren“) kommt mit den scharfen Aktionen.</p>
        <ul className="divide-y rounded-md border text-sm">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 p-2">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{c.project.nr}</span>
              <span className="min-w-0 flex-1 truncate">{c.project.name}<span className="text-muted-foreground"> · {c.project.kunde}</span></span>
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">{c.project.stepName.replace(/^[^\p{L}\p{N}]+/u, "")}</span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums">{tageText(c.reasons.days ?? c.project.days)}</span>
              <HeroLink id={c.project.heroId} label="HERO" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Followups({ items, onWake, busy }: { items: FollowupItem[]; onWake: (id: string) => void; busy: boolean }) {
  if (!items.length) return <p className="rounded-md border p-4 text-sm text-muted-foreground">Keine Wiedervorlagen.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {items.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="w-24 shrink-0 font-medium tabular-nums">{new Date(f.dueAt).toLocaleDateString("de-DE")}</span>
          <span className="min-w-0 flex-1"><b>{f.project.nr}</b> {f.project.name}<span className="block text-xs text-muted-foreground">{f.reason}</span></span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onWake(f.id)}>Jetzt holen</Button>
        </li>
      ))}
    </ul>
  );
}

const PRESETS: { label: string; days: number }[] = [{ label: "Morgen", days: 1 }, { label: "3 Tage", days: 3 }, { label: "1 Woche", days: 7 }, { label: "2 Wochen", days: 14 }];
const isoDay = (daysAhead: number) => { const d = new Date(); d.setDate(d.getDate() + daysAhead); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function SnoozeDialog({ card, onClose, onDone }: { card: ProjectCard; onClose: () => void; onDone: () => void }) {
  const preset = card.followupDays && card.followupDays > 0 ? card.followupDays : 7;
  const [date, setDate] = useState(isoDay(preset));
  const [reason, setReason] = useState(card.followupReason || card.suggestion || "");
  const save = useMutation({
    mutationFn: () => papi("snooze", { heroId: card.project.heroId, dueAt: date, reason }),
    onSuccess: () => { toast.success("Wiedervorlage gesetzt."); onDone(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const active = useMemo(() => PRESETS.find((p) => isoDay(p.days) === date)?.days, [date]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Wiedervorlage">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-xl">
        <h2 className="font-semibold">Wiedervorlage: {card.project.nr} {card.project.name}</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => <Button key={p.days} size="sm" variant={active === p.days ? "default" : "outline"} onClick={() => setDate(isoDay(p.days))}>{p.label}</Button>)}
        </div>
        <Field label="Datum"><Input type="date" value={date} min={isoDay(1)} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Grund (Pflicht)"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !reason.trim() || !date}>Wiedervorlage setzen</Button>
        </div>
      </div>
    </div>
  );
}

export type { ProjectView };
