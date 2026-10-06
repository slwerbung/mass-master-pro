import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Inbox, ListTree, LogOut, Settings as Cog } from "lucide-react";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Overview } from "@/lib/types";
import { Badge, Button, ErrorBox } from "@/components/ui";
import { cn } from "@/lib/utils";

export default function Layout({ children }: { children: ReactNode }) {
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
  const open = overview.data?.openSuggestions ?? 0;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="flex shrink-0 gap-1 border-b bg-muted/40 p-2 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-3">
        <div className="hidden px-3 py-2 text-sm font-semibold md:block">Mail-Assistent</div>
        <NavLink to="/" end className={({ isActive }) => cn(item, isActive && "bg-accent")}>
          <Inbox className="h-4 w-4" /> Zu entscheiden
          {open > 0 && <Badge variant="danger" className="ml-auto">{open}</Badge>}
        </NavLink>
        <NavLink to="/mails" className={({ isActive }) => cn(item, isActive && "bg-accent")}>
          <ListTree className="h-4 w-4" /> Alle Mails
        </NavLink>
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
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
