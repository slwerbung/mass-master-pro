import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Folder, Inbox, ListTree, LogOut, Menu, MessagesSquare, PenSquare, RefreshCw, Send, Settings as Cog, Trash2, X } from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import { useMe } from "@/lib/me";
import { supabase } from "@/lib/supabase";
import type { Overview } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS, INBOX_CATEGORIES } from "@/lib/shared";
import { Badge, Button, ErrorBox } from "@/components/ui";
import { cn, errorText } from "@/lib/utils";

/** Neue Mails sofort holen statt auf den Minutentakt zu warten (email-sync, nur eigene Postfaecher). */
function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invokeFn<{ accountId: string; stored?: number; error?: string; skipped?: string }[]>("email-sync", {}),
    onSuccess: (r) => {
      const stored = r.reduce((n, x) => n + (x.stored ?? 0), 0);
      const errors = r.filter((x) => x.error);
      const busy = r.filter((x) => x.skipped);
      if (errors.length) toast.error(`Abruf mit Fehler: ${errors[0].error}`);
      else if (stored) toast.success(`${stored} neue Mail(s) abgeholt – werden jetzt verarbeitet.`);
      else if (busy.length === r.length && r.length) toast("Abruf läuft gerade schon – gleich noch einmal versuchen.");
      else toast("Keine neuen Mails.");
      // Verarbeitung laeuft im Hintergrund weiter: jetzt und kurz danach neu laden.
      const refresh = () => ["messages", "topics", "suggestions", "overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      refresh();
      if (stored) { setTimeout(refresh, 8_000); setTimeout(refresh, 25_000); }
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const me = useMe();
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("overview"), refetchInterval: 60_000, enabled: me.isSuccess });
  const sync = useSyncNow();
  const [menu, setMenu] = useState(false);
  // Nach jedem Seitenwechsel (auch Ordner-Filter) das Handy-Menue schliessen.
  useEffect(() => { setMenu(false); }, [loc.pathname, loc.search]);

  if (me.isError) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">Kein Zugriff</h1>
        <ErrorBox error={me.error} />
        <p className="text-sm text-muted-foreground">
          Zugang haben Admins und Mitarbeiter, denen ein Postfach zugeordnet ist (Einstellungen → Benutzer, nur für Admins).
        </p>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>Abmelden</Button>
      </div>
    );
  }

  const open = overview.data?.topics?.entscheiden ?? overview.data?.openSuggestions ?? 0;
  const syncButton = (cls?: string) => (
    <Button variant="outline" size="sm" className={cls} onClick={() => sync.mutate()} disabled={sync.isPending || !me.isSuccess} title="Neue Mails jetzt abrufen">
      <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} /> Jetzt abrufen
    </Button>
  );
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Handy (Hochformat): Kopfleiste mit Menue – die Seitenleiste mit Postfaechern und Einstellungen klappt darunter auf. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-2 py-2 backdrop-blur md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMenu(true)} aria-label="Menü öffnen"><Menu className="h-5 w-5" /></Button>
        <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="truncate">Mail-Assistent</span>
          {open > 0 && <Badge variant="danger">{open}</Badge>}
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => sync.mutate()} disabled={sync.isPending || !me.isSuccess} aria-label="Neue Mails jetzt abrufen">
            <RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} />
          </Button>
          <Link to="/verfassen" aria-label="Neue Mail"><Button size="icon"><PenSquare className="h-4 w-4" /></Button></Link>
        </div>
      </header>
      {menu && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
          <nav className="absolute inset-y-0 left-0 flex w-[85vw] max-w-xs flex-col gap-1 overflow-y-auto bg-background p-3 shadow-xl [&>*]:shrink-0">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-sm font-semibold">Mail-Assistent</span>
              <Button variant="ghost" size="icon" onClick={() => setMenu(false)} aria-label="Menü schließen"><X className="h-5 w-5" /></Button>
            </div>
            <SidebarContent open={open} overview={overview.data} meOk={me.isSuccess} name={me.data?.name} hidden={me.data?.hiddenCategories ?? []} syncButton={syncButton("mb-1 w-full justify-start")} />
          </nav>
        </div>
      )}
      <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r bg-muted/40 p-3 md:flex [&>*]:shrink-0">
        <div className="px-3 py-2 text-sm font-semibold">Mail-Assistent</div>
        <SidebarContent open={open} overview={overview.data} meOk={me.isSuccess} name={me.data?.name} hidden={me.data?.hiddenCategories ?? []} syncButton={syncButton("mb-1 justify-start")} />
      </nav>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        {overview.data?.budgetExceeded && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Das KI-Monatsbudget ({overview.data.budgetUsd} $) ist erreicht. Es laufen nur noch Regeln und das Logbuch über Thread und Projektnummer – neue Mails bleiben unklassifiziert im Posteingang.
            Das Budget lässt sich unter Einstellungen → Firma &amp; HERO anheben.
          </div>
        )}
        {overview.data && overview.data.neuronsToday >= 10000 && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Das kostenlose Cloudflare-Tageskontingent (10.000 Neurons) ist aufgebraucht – der Rest des Tages läuft über den Ausweich-Anbieter bzw. wartet bis Mitternacht (UTC), je nach Einstellung.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** Inhalt der Seitenleiste – auf dem Desktop links fest, auf dem Handy im aufklappbaren Menue. */
function SidebarContent({ open, overview, meOk, name, hidden, syncButton }: {
  open: number; overview: Overview | undefined; meOk: boolean; name?: string; hidden: string[]; syncButton: ReactNode;
}) {
  const loc = useLocation();
  const item = "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent";
  return (
    <>
      <Link to="/verfassen" className="mb-1 flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <PenSquare className="h-4 w-4" /> Neue Mail
      </Link>
      {syncButton}
      <NavLink to="/" end className={({ isActive }) => cn(item, isActive && "bg-accent")}>
        <Inbox className="h-4 w-4" /> Zu entscheiden
        {open > 0 && <Badge variant="danger" className="ml-auto">{open}</Badge>}
      </NavLink>
      <NavLink to="/themen" className={({ isActive }) => cn(item, isActive && "bg-accent")}>
        <MessagesSquare className="h-4 w-4" /> Themen
        {!!overview?.topics?.wiedervorlage && <span className="ml-auto text-xs tabular-nums text-muted-foreground" title="auf Wiedervorlage">{overview.topics.wiedervorlage}</span>}
      </NavLink>
      <NavLink to="/mails" className={({ isActive }) => cn(item, isActive && !loc.search && "bg-accent")}>
        <ListTree className="h-4 w-4" /> Alle Mails
      </NavLink>
      <Folders enabled={meOk} hidden={hidden} />
      {meOk && (
        <NavLink to="/einstellungen" className={({ isActive }) => cn(item, isActive && "bg-accent")}>
          <Cog className="h-4 w-4" /> Einstellungen
        </NavLink>
      )}
      <div className="mt-auto px-3 py-2 text-xs text-muted-foreground">
        {name}
        <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => supabase.auth.signOut()}>
          <LogOut className="h-3 w-3" /> Abmelden
        </Button>
      </div>
    </>
  );
}

interface AccountLite { id: string; label: string; address: string }

const OPEN_KEY = "mail.sidebar.open";
function loadOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}"); } catch { return {}; }
}

/**
 * Kategorien als Ordner (Desktop-Seitenleiste und Handy-Menue); gesperrte Kategorien fehlen. Zahlen = alle Mails der Kategorie ohne Papierkorb.
 * Bei mehreren Postfächern: „Alle Postfächer“ und darunter je Postfach ein eigener Ordnerbaum (auf-/zuklappbar).
 */
function Folders({ enabled, hidden }: { enabled: boolean; hidden: string[] }) {
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<AccountLite[]>("list_accounts"), enabled, staleTime: 300_000 });
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);
  const toggle = (k: string, def: boolean) => setOpen((o) => {
    const n = { ...o, [k]: !(o[k] ?? def) };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const list = accounts.data ?? [];
  if (list.length <= 1) return <div><FolderTree enabled={enabled} accountId={null} hidden={hidden} /><div className="border-b pt-2" /></div>;
  const group = (key: string, label: string, title: string, accountId: string | null, def: boolean) => {
    const isOpen = open[key] ?? def;
    return (
      <div key={key}>
        <button type="button" title={title} onClick={() => toggle(key, def)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
          <span className="truncate">{label}</span>
        </button>
        {isOpen && <div className="pl-1"><FolderTree enabled={enabled} accountId={accountId} hidden={hidden} /></div>}
      </div>
    );
  };
  return (
    <div className="space-y-1">
      {group("alle", "Alle Postfächer", "Alle Postfächer zusammen", null, true)}
      {list.map((a) => group(a.id, a.label || a.address, a.address, a.id, false))}
      <div className="border-b pt-2" />
    </div>
  );
}

/** Ordnerbaum eines Postfachs (accountId) oder aller Postfächer (null). */
function FolderTree({ enabled, accountId, hidden }: { enabled: boolean; accountId: string | null; hidden: string[] }) {
  const loc = useLocation();
  const facets = useQuery({
    queryKey: ["messages", "facets", "sidebar", accountId ?? "alle"],
    queryFn: () => api<{ categories: Record<string, number> }>("message_facets", accountId ? { accountId } : {}),
    enabled, staleTime: 60_000, refetchInterval: 120_000,
  });
  const counts = facets.data?.categories ?? {};
  const sp = new URLSearchParams(loc.search);
  const onMails = loc.pathname === "/mails";
  const scope: Record<string, string> = accountId ? { accountId } : {};
  const href = (k: string, v: string) => `/mails?${new URLSearchParams({ [k]: v, ...scope })}`;
  // aktiv = genau dieser Filter (und dasselbe Postfach), sonst nichts
  const active = (k: string, v: string) => {
    if (!onMails) return false;
    const want: Record<string, string> = { [k]: v, ...scope };
    const keys = [...sp.keys()];
    return keys.length === Object.keys(want).length && keys.every((x) => sp.get(x) === want[x]);
  };
  const row = "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent";
  const entry = (k: string, v: string, icon: ReactNode, label: string, count?: number) => (
    <Link key={`${k}=${v}`} to={href(k, v)} className={cn(row, active(k, v) && "bg-accent font-medium")}>
      {icon}<span className="truncate">{label}</span>
      {!!count && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count.toLocaleString("de-DE")}</span>}
    </Link>
  );
  const folder = <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  const other = CATEGORIES.filter((c) => !INBOX_CATEGORIES.includes(c) && !hidden.includes(c));
  const inbox = INBOX_CATEGORIES.filter((c) => !hidden.includes(c));
  return (
    <div className="space-y-0.5">
      {entry("direction", "in", <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />, "Posteingang")}
      <div className="pl-3">{inbox.map((c) => entry("category", c, folder, CATEGORY_LABELS[c], counts[c]))}</div>
      <div className="px-3 pb-0.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ablage</div>
      <div className="pl-3">{other.map((c) => entry("category", c, folder, CATEGORY_LABELS[c], counts[c]))}</div>
      <div className="pt-2">
        {entry("direction", "out", <Send className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />, "Gesendet")}
        {entry("view", "papierkorb", <Trash2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />, "Papierkorb")}
      </div>
    </div>
  );
}
