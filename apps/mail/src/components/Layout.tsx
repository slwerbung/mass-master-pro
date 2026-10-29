import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Folder, Inbox, ListTree, LogOut, MessagesSquare, PenSquare, Send, Settings as Cog, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Overview } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS, INBOX_CATEGORIES } from "@/lib/shared";
import { Badge, Button, ErrorBox } from "@/components/ui";
import { cn } from "@/lib/utils";

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ name: string; email: string | null }>("me"), retry: false });
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("overview"), refetchInterval: 60_000, enabled: me.isSuccess });

  if (me.isError) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">Kein Zugriff</h1>
        <ErrorBox error={me.error} />
        <p className="text-sm text-muted-foreground">
          Die Mail-App ist nur für Konten mit der Rolle „admin“. Konten legt Silas im Supabase-Dashboard an.
        </p>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>Abmelden</Button>
      </div>
    );
  }

  const item = "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent";
  const open = overview.data?.topics?.entscheiden ?? overview.data?.openSuggestions ?? 0;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/40 p-2 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-3">
        <div className="hidden px-3 py-2 text-sm font-semibold md:block">Mail-Assistent</div>
        <Link to="/verfassen" className="mb-1 flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <PenSquare className="h-4 w-4" /> <span className="hidden sm:inline">Neue Mail</span>
        </Link>
        <NavLink to="/" end className={({ isActive }) => cn(item, isActive && "bg-accent")}>
          <Inbox className="h-4 w-4" /> Zu entscheiden
          {open > 0 && <Badge variant="danger" className="ml-auto">{open}</Badge>}
        </NavLink>
        <NavLink to="/themen" className={({ isActive }) => cn(item, isActive && "bg-accent")}>
          <MessagesSquare className="h-4 w-4" /> Themen
          {!!overview.data?.topics?.wiedervorlage && <span className="ml-auto text-xs tabular-nums text-muted-foreground" title="auf Wiedervorlage">{overview.data.topics.wiedervorlage}</span>}
        </NavLink>
        <NavLink to="/mails" className={({ isActive }) => cn(item, isActive && !loc.search && "bg-accent")}>
          <ListTree className="h-4 w-4" /> Alle Mails
        </NavLink>
        <Folders enabled={me.isSuccess} />
        <NavLink to="/einstellungen" className={({ isActive }) => cn(item, isActive && "bg-accent")}>
          <Cog className="h-4 w-4" /> Einstellungen
        </NavLink>
        <div className="mt-auto hidden px-3 py-2 text-xs text-muted-foreground md:block">
          {me.data?.name}
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => supabase.auth.signOut()}>
            <LogOut className="h-3 w-3" /> Abmelden
          </Button>
        </div>
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

/** Kategorien als Ordner (nur Desktop). Zahlen = alle Mails der Kategorie ohne Papierkorb. */
function Folders({ enabled }: { enabled: boolean }) {
  const loc = useLocation();
  const facets = useQuery({
    queryKey: ["messages", "facets", "sidebar"],
    queryFn: () => api<{ categories: Record<string, number> }>("message_facets", {}),
    enabled, staleTime: 60_000, refetchInterval: 120_000,
  });
  const counts = facets.data?.categories ?? {};
  const sp = new URLSearchParams(loc.search);
  const onMails = loc.pathname === "/mails";
  const active = (k: string, v: string) => onMails && sp.get(k) === v && [...sp.keys()].every((x) => x === k);
  const row = "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent";
  const entry = (to: string, isActive: boolean, icon: ReactNode, label: string, count?: number) => (
    <Link key={to} to={to} className={cn(row, isActive && "bg-accent font-medium")}>
      {icon}<span className="truncate">{label}</span>
      {!!count && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count.toLocaleString("de-DE")}</span>}
    </Link>
  );
  const folder = <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  const other = CATEGORIES.filter((c) => !INBOX_CATEGORIES.includes(c));
  return (
    <div className="hidden space-y-0.5 md:block">
      {entry("/mails?direction=in", active("direction", "in"), <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />, "Posteingang")}
      <div className="pl-3">{INBOX_CATEGORIES.map((c) => entry(`/mails?category=${c}`, active("category", c), folder, CATEGORY_LABELS[c], counts[c]))}</div>
      <div className="px-3 pb-0.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ablage</div>
      <div className="pl-3">{other.map((c) => entry(`/mails?category=${c}`, active("category", c), folder, CATEGORY_LABELS[c], counts[c]))}</div>
      <div className="pt-2">
        {entry("/mails?direction=out", active("direction", "out"), <Send className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />, "Gesendet")}
        {entry("/mails?view=papierkorb", active("view", "papierkorb"), <Trash2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />, "Papierkorb")}
      </div>
      <div className="border-b pt-2" />
    </div>
  );
}
