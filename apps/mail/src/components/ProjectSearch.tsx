import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Input, Spinner } from "@/components/ui";

export interface HeroProjectHit { id: number; nr: string; name: string; stepName: string | null; customerName: string }

/** Projektsuche in HERO (Nummer, Name, Kunde). */
export function ProjectSearch({ onPick, selectedId }: { onPick: (p: HeroProjectHit) => void; selectedId?: number | null }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const res = useQuery({
    queryKey: ["projectSearch", term],
    queryFn: () => api<HeroProjectHit[]>("search_projects", { q: term }),
    enabled: term.length >= 2,
  });
  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <Input placeholder="Projekt suchen (WER-1234, Name, Kunde) und Enter" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {res.isFetching && <Spinner />}
      {res.error && <p className="text-xs text-red-700">{(res.error as Error).message}</p>}
      {res.data?.map((p) => (
        <button
          key={p.id} type="button" onClick={() => onPick(p)}
          className={`block w-full rounded-md border p-2 text-left text-sm hover:bg-accent ${selectedId === p.id ? "border-primary bg-accent" : ""}`}
        >
          <b>{p.nr}</b> · {p.name || "(ohne Name)"} <span className="text-xs text-muted-foreground">· {p.customerName} · {p.stepName ?? "?"}</span>
        </button>
      ))}
      {res.data && !res.data.length && <p className="text-xs text-muted-foreground">Nichts gefunden.</p>}
    </div>
  );
}
