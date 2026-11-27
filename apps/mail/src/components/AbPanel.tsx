import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";
import { pact, type ActionResult } from "@/lib/projects";
import { Button, ErrorBox, Input, Spinner } from "@/components/ui";
import { useHeroViewer } from "@/components/HeroViewer";
import { cn, errorText } from "@/lib/utils";

interface Pos { sourceDocId: number; uid: string; name: string; unit: string; quantity: number; sourceQuantity: number; netPrice: number; include: boolean }
interface Preview { offer: { id: number; nr: string; date: string | null } | null; positions: Pos[]; existing: { nr: string; status: string }[]; configured: boolean }
interface AbCreated extends ActionResult { documentId: number | null; documentNr: string | null; positions: number }

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/**
 * „AB fehlt“: die AB direkt hier als ENTWURF in HERO anlegen – Positionen des neuesten Angebots, Auswahl und Mengen änderbar.
 * Prüfen, Abschließen und Versenden bleibt ein eigener Schritt (in HERO bzw. per Klick in der Mail-App).
 */
export function AbPanel({ heroId, busy, onDone }: { heroId: number; busy?: boolean; onDone: (r: ActionResult) => void }) {
  const openHero = useHeroViewer();
  const q = useQuery({ queryKey: ["projects", "ab_prepare", heroId], queryFn: () => pact<Preview>("ab_prepare", { heroId }), retry: false });
  const [rows, setRows] = useState<Pos[]>([]);
  useEffect(() => { if (q.data) setRows(q.data.positions); }, [q.data]);

  const create = useMutation({
    mutationFn: () => pact<AbCreated>("ab_create", { heroId, positions: rows.map((r) => ({ sourceDocId: r.sourceDocId, uid: r.uid, quantity: r.quantity, include: r.include })) }),
    onSuccess: (r) => {
      (r.warnings ?? []).forEach((w) => toast.warning(w, { duration: 9000 }));
      toast.success(r.message, { duration: 9000 });
      onDone(r);
    },
    onError: (e) => toast.error(errorText(e), { duration: 9000 }),
  });

  if (q.isLoading) return <Spinner />;
  const p = q.data;
  if (q.error || !p) return <ErrorBox error={q.error} />;
  if (!p.offer) return <p className="text-sm text-muted-foreground">Kein abgeschlossenes Angebot mit Positionen in HERO. Die AB muss dort von Hand angelegt werden.</p>;

  const chosen = rows.filter((r) => r.include && r.quantity > 0);
  const sum = chosen.reduce((s, r) => s + r.quantity * r.netPrice, 0);
  const set = (i: number, patch: Partial<Pos>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3 rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FilePlus2 className="h-4 w-4 text-primary" />
        <b>AB aus Angebot {p.offer.nr}</b>
        {p.offer.date && <span className="text-xs text-muted-foreground">vom {new Date(p.offer.date).toLocaleDateString("de-DE")}</span>}
      </div>
      {p.existing.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
          In HERO gibt es schon: {p.existing.map((a) => `${a.nr} (${a.status})`).join(", ")}. Nur anlegen, wenn eine weitere AB nötig ist.
        </p>
      )}
      <ul className="divide-y rounded-md border">
        {rows.map((r, i) => (
          <li key={`${r.sourceDocId}/${r.uid}`} className={cn("flex items-center gap-2 p-2", !r.include && "opacity-50")}>
            <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} aria-label={`${r.name} übernehmen`} />
            <span className="min-w-0 flex-1 truncate" title={r.name}>{r.name}</span>
            <Input type="number" min={0} step="any" className="h-8 w-20 text-right" value={r.quantity} disabled={!r.include}
              onChange={(e) => set(i, { quantity: Number(e.target.value) })} aria-label={`Menge ${r.name}`} />
            <span className="w-10 text-xs text-muted-foreground">{r.unit}</span>
            <span className="w-24 text-right text-xs text-muted-foreground">{euro(r.quantity * r.netPrice)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || create.isPending || !chosen.length || !p.configured} onClick={() => create.mutate()}>
          <FilePlus2 className="h-4 w-4" /> AB-Entwurf in HERO anlegen
        </Button>
        <span className="text-xs text-muted-foreground">{chosen.length} Position(en), netto {euro(sum)}</span>
        <Button variant="ghost" size="sm" onClick={() => openHero(heroId)}>In HERO ansehen</Button>
      </div>
      {!p.configured && <p className="text-xs text-destructive">Der Dokumenttyp „Auftragsbestätigung“ ist nicht eingerichtet (Mail-Einstellungen → Firma &amp; HERO).</p>}
      <p className="text-xs text-muted-foreground">Es wird nur ein Entwurf angelegt. Prüfen, abschließen und versenden machst du danach in HERO.</p>
    </div>
  );
}
