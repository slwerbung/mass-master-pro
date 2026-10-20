import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { KnowledgeRow } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Spinner, Switch, Textarea } from "@/components/ui";
import { cn, errorText, formatDate } from "@/lib/utils";

type Filter = "alle" | "allgemein" | "absender" | "aus";

function Row({ k }: { k: KnowledgeRow }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(k.text);
  const [pattern, setPattern] = useState(k.from_pattern ?? "");
  const refresh = () => qc.invalidateQueries({ queryKey: ["knowledge"] });
  const save = useMutation({
    mutationFn: (p: Record<string, unknown>) => api("save_knowledge", { id: k.id, ...p }),
    onSuccess: () => { setEdit(false); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const del = useMutation({ mutationFn: () => api("delete_knowledge", { id: k.id }), onSuccess: refresh, onError: (e) => toast.error(errorText(e)) });

  return (
    <div className={cn("space-y-2 p-3 text-sm", !k.active && "opacity-60")}>
      {edit ? (
        <div className="space-y-2">
          <Textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-64" placeholder="Absender (leer = alle Mails)" value={pattern} onChange={(e) => setPattern(e.target.value)} />
            <Button size="sm" onClick={() => save.mutate({ text, from_pattern: pattern })} disabled={save.isPending}>Speichern</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEdit(false); setText(k.text); setPattern(k.from_pattern ?? ""); }}>Abbrechen</Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap">{k.text}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {k.from_pattern ? <Badge variant="outline">{k.from_pattern}</Badge> : <Badge>alle Mails</Badge>}
        <Badge variant="secondary">{k.source === "korrektur" ? "aus Korrektur" : "von Hand"}</Badge>
        <span>{formatDate(k.created_at)}</span>
        {k.message_id && <Link className="truncate underline" to={`/mails/${k.message_id}`}>{k.message_subject || "Mail öffnen"}</Link>}
        <div className="ml-auto flex items-center gap-1">
          <Switch checked={k.active} onChange={(v) => save.mutate({ active: v })} label="aktiv" />
          {!edit && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Bearbeiten</Button>}
          <Button size="sm" variant="ghost" onClick={() => { if (confirm("Eintrag löschen?")) del.mutate(); }}>Löschen</Button>
        </div>
      </div>
    </div>
  );
}

export default function Knowledge() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["knowledge"], queryFn: () => api<KnowledgeRow[]>("list_knowledge") });
  const [n, setN] = useState({ text: "", from_pattern: "" });
  const [filter, setFilter] = useState<Filter>("alle");
  const [search, setSearch] = useState("");
  const add = useMutation({
    mutationFn: () => api("save_knowledge", n),
    onSuccess: () => { toast.success("Eintrag gespeichert"); setN({ text: "", from_pattern: "" }); qc.invalidateQueries({ queryKey: ["knowledge"] }); },
    onError: (e) => toast.error(errorText(e)),
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((k) => {
      if (filter === "allgemein" && (k.from_pattern || !k.active)) return false;
      if (filter === "absender" && (!k.from_pattern || !k.active)) return false;
      if (filter === "aus" && k.active) return false;
      return !s || k.text.toLowerCase().includes(s) || (k.from_pattern ?? "").includes(s);
    });
  }, [q.data, filter, search]);
  const count = (f: Filter) => (q.data ?? []).filter((k) => (f === "aus" ? !k.active : k.active && (f === "alle" || (f === "allgemein") === !k.from_pattern))).length;
  const filters: { key: Filter; label: string }[] = [
    { key: "alle", label: "Aktiv" }, { key: "allgemein", label: "Für alle Mails" }, { key: "absender", label: "Je Absender" }, { key: "aus", label: "Ausgeschaltet" },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Die Wissensdatei sammelt, was du dem Assistenten beigebracht hast – meist über „Falsch? Erklären“ an einer Mail oder einem Vorschlag.
        Einträge für alle Mails liest die KI bei jeder Mail mit, Einträge für einen Absender nur bei dessen Mails. Beides wirkt beim Einsortieren und bei der Projektzuordnung.
        Feste Zuordnungen „Absender → Kategorie“ ohne KI stehen unter Absenderregeln.
      </p>
      <Card>
        <CardHeader><CardTitle>Neuer Eintrag</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Was soll der Assistent wissen?">
            <Textarea rows={2} maxLength={1000} value={n.text} onChange={(e) => setN({ ...n, text: e.target.value })} placeholder="z. B. „Anfragen über das Kontaktformular von slwerbung.de sind immer neue Anfragen, auch wenn der Absender wordpress@ ist.“" />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Gilt für" hint="Leer = alle Mails, sonst a@b.de oder @b.de">
              <Input className="w-72" value={n.from_pattern} onChange={(e) => setN({ ...n, from_pattern: e.target.value })} />
            </Field>
            <Button onClick={() => add.mutate()} disabled={n.text.trim().length < 3 || add.isPending}>Speichern</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
          {filters.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={cn("rounded-md px-3 py-1 text-sm", filter === f.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f.label} <span className="text-xs text-muted-foreground">{count(f.key)}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Durchsuchen" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : (
        <div className="divide-y rounded-lg border bg-card">
          {rows.map((k) => <Row key={`${k.id}-${k.updated_at}`} k={k} />)}
          {!rows.length && <div className="p-4 text-sm text-muted-foreground">Keine Einträge.</div>}
        </div>
      )}
    </div>
  );
}
