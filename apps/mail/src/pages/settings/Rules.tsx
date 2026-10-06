import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Rule } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Switch } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { errorText } from "@/lib/utils";

export default function Rules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("list_rules") });
  const [n, setN] = useState<{ pattern: string; category: Category; protect: boolean }>({ pattern: "", category: "lieferant", protect: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rules"] });
  const save = useMutation({
    mutationFn: () => api("save_rule", n),
    onSuccess: () => { toast.success("Regel gespeichert"); setN({ ...n, pattern: "" }); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => api("delete_rule", { id }), onSuccess: refresh, onError: (e) => toast.error(errorText(e)) });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Regeln entscheiden ohne KI – schnell, kostenlos und nachvollziehbar. Genaue Adressen gehen vor Domains. „Schützen“ heißt: nie in „9 Aussortiert“.
        Hat ein Mensch die Kategorie eines Absenders zweimal gleich korrigiert, entsteht automatisch eine gelernte Regel.
      </p>
      <Card>
        <CardHeader><CardTitle>Neue Regel</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Adresse oder Domain" hint="a@b.de oder @b.de"><Input value={n.pattern} onChange={(e) => setN({ ...n, pattern: e.target.value })} /></Field>
            <Field label="Kategorie">
              <Select value={n.category} onChange={(e) => setN({ ...n, category: e.target.value as Category })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </Select>
            </Field>
            <div className="flex items-end"><Switch checked={n.protect} onChange={(v) => setN({ ...n, protect: v })} label="Schützen" /></div>
          </div>
          <Button onClick={() => save.mutate()} disabled={!n.pattern || save.isPending}>Speichern</Button>
        </CardContent>
      </Card>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : (
        <div className="divide-y rounded-lg border bg-card">
          {q.data?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <code className="font-mono">{r.pattern}</code>
              <CategoryChip category={r.category} />
              {r.protect && <Badge variant="good">geschützt</Badge>}
              <Badge variant="secondary">{r.source}</Badge>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => del.mutate(r.id)}>Entfernen</Button>
            </div>
          ))}
          {q.data && !q.data.length && <div className="p-4 text-sm text-muted-foreground">Noch keine Regeln.</div>}
        </div>
      )}
    </div>
  );
}
