import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input, Spinner } from "@/components/ui";
import { HeroLink } from "@/components/HeroLink";
import { cn, errorText } from "@/lib/utils";

export interface HeroProjectHit { id: number; nr: string; name: string; stepName: string | null; customerName: string }

/**
 * Projektsuche in HERO (Nummer „WER-1234“ oder „1234“, Projektname, Kunde). Sucht beim Tippen (kurz verzögert),
 * Enter oder Lupe sucht sofort. Jede Zeile hat einen Link, der das Projekt in HERO öffnet.
 */
export function ProjectSearch({ onPick, selectedId, autoFocus }: { onPick: (p: HeroProjectHit) => void; selectedId?: number | null; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 450);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({
    queryKey: ["projectSearch", term],
    queryFn: () => api<HeroProjectHit[]>("search_projects", { q: term }),
    enabled: term.length >= 2,
    staleTime: 60_000,
    retry: false,
  });
  const go = () => setTerm(q.trim());
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Projekt suchen: WER-1234, Projektname oder Kunde" value={q} autoFocus={autoFocus} enterKeyHint="search"
          onChange={(e) => setQ(e.target.value)}
          // Kein <form>: die Suche steckt oft in anderen Formularen/Karten; Enter soll dort nichts absenden.
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
        />
        <Button type="button" variant="outline" size="icon" onClick={go} disabled={q.trim().length < 2} aria-label="Suchen">
          {res.isFetching ? <Spinner /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
      {q.trim().length === 1 && <p className="text-xs text-muted-foreground">Mindestens 2 Zeichen.</p>}
      {res.error && <p className="text-xs text-red-700">Suche fehlgeschlagen: {errorText(res.error)}</p>}
      {term.length >= 2 && res.data?.map((p) => (
        <div key={p.id} className={cn("flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent", selectedId === p.id && "border-primary bg-accent")}>
          <button type="button" onClick={() => onPick(p)} className="min-w-0 flex-1 text-left">
            <b>{p.nr}</b> · {p.name || "(ohne Name)"} <span className="text-xs text-muted-foreground">· {p.customerName || "?"} · {p.stepName ?? "?"}</span>
          </button>
          <HeroLink id={p.id} label="HERO" />
        </div>
      ))}
      {term.length >= 2 && res.data && !res.data.length && <p className="text-xs text-muted-foreground">Nichts gefunden.</p>}
    </div>
  );
}
