import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Spinner, Switch, Textarea } from "@/components/ui";
import { cn, errorText, formatDate } from "@/lib/utils";

interface RefDoc { id: string; title: string; content: string; tasks: string[]; active: boolean; created_at: string; updated_at: string }

const TASKS: { key: string; label: string; hint: string }[] = [
  { key: "prepare_offer", label: "Angebote", hint: "Anfrage → Angebot vorbereiten" },
  { key: "prepare_confirmation", label: "Auftragsbestätigungen", hint: "Bestellung → AB vorbereiten" },
  { key: "understand", label: "Einsortieren", hint: "jede Mail – knapp halten" },
  { key: "draft", label: "Antwortentwürfe", hint: "jede Antwort – knapp halten" },
];
const MAX = 60000;

function DocEditor({ doc, onDone }: { doc: RefDoc | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [content, setContent] = useState(doc?.content ?? "");
  const [tasks, setTasks] = useState<string[]>(doc?.tasks ?? ["prepare_offer", "prepare_confirmation"]);
  const save = useMutation({
    mutationFn: () => api("save_reference_doc", { id: doc?.id, title, content, tasks }),
    onSuccess: () => { toast.success("Gespeichert"); qc.invalidateQueries({ queryKey: ["reference_docs"] }); onDone(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const load = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX * 4) { toast.error("Datei zu groß – höchstens ca. 60.000 Zeichen je Dokument."); return; }
    const text = await f.text();
    setContent(text.slice(0, MAX));
    if (!title.trim()) setTitle(f.name.replace(/\.(md|txt|markdown)$/i, ""));
    if (text.length > MAX) toast.warning("Gekürzt auf 60.000 Zeichen – bitte in mehrere Dokumente aufteilen.");
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Titel"><Input className="w-80" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Angebotserstellung (hero-angebote)" /></Field>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <FileUp className="h-4 w-4" /> Datei laden (.md / .txt)
          <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" className="hidden" onChange={(e) => load(e.target.files?.[0])} />
        </label>
      </div>
      <Field label={`Inhalt (${content.length.toLocaleString("de-DE")} / 60.000 Zeichen)`}>
        <Textarea rows={16} className="font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value.slice(0, MAX))} />
      </Field>
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Die KI liest dieses Dokument bei</div>
        <div className="flex flex-wrap gap-1.5">
          {TASKS.map((t) => {
            const on = tasks.includes(t.key);
            return (
              <button key={t.key} type="button" title={t.hint} onClick={() => setTasks(on ? tasks.filter((x) => x !== t.key) : [...tasks, t.key])}
                className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={title.trim().length < 2 || save.isPending}>{save.isPending && <Spinner />} Speichern</Button>
        <Button variant="ghost" onClick={onDone}>Abbrechen</Button>
      </div>
    </div>
  );
}

export default function ReferenceDocs() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reference_docs"], queryFn: () => api<RefDoc[]>("list_reference_docs") });
  const [editing, setEditing] = useState<string | "neu" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["reference_docs"] });
  const toggle = useMutation({ mutationFn: (d: RefDoc) => api("save_reference_doc", { id: d.id, active: !d.active }), onSuccess: refresh, onError: (e) => toast.error(errorText(e)) });
  const del = useMutation({ mutationFn: (id: string) => api("delete_reference_doc", { id }), onSuccess: refresh, onError: (e) => toast.error(errorText(e)) });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Längere Dokumente, die die KI bei bestimmten Aufgaben mitliest – z. B. die Skill-Datei zur Angebotserstellung (Leistungen, Kalkulation,
        was für Auftragsbestätigungen gilt) oder die HERO-Doku. Einzelne Sätze („Mails von X sind Y“) gehören in die Wissensdatei.
        Keine Kundennamen oder Adressen hineinschreiben. Pro KI-Aufruf werden höchstens 30.000 Zeichen gelesen (Einsortieren/Entwürfe: 8.000).
      </p>
      {editing === "neu" ? (
        <Card><CardHeader><CardTitle>Neues Dokument</CardTitle></CardHeader><CardContent><DocEditor doc={null} onDone={() => setEditing(null)} /></CardContent></Card>
      ) : (
        <Button onClick={() => setEditing("neu")}>Dokument hinzufügen</Button>
      )}
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : (
        <div className="space-y-3">
          {q.data?.map((d) => (
            <Card key={d.id} className={cn(!d.active && "opacity-70")}>
              <CardContent className="space-y-2 p-4">
                {editing === d.id ? <DocEditor doc={d} onDone={() => setEditing(null)} /> : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.title}</span>
                      {d.tasks.map((t) => <Badge key={t} variant="outline">{TASKS.find((x) => x.key === t)?.label ?? t}</Badge>)}
                      <span className="text-xs text-muted-foreground">{d.content.length.toLocaleString("de-DE")} Zeichen · {formatDate(d.updated_at)}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <Switch checked={d.active} onChange={() => toggle.mutate(d)} label="aktiv" />
                        <Button size="sm" variant="ghost" onClick={() => setEditing(d.id)}>Bearbeiten</Button>
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm(`„${d.title}“ löschen?`)) del.mutate(d.id); }}>Löschen</Button>
                      </div>
                    </div>
                    <pre className="max-h-32 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">{d.content.slice(0, 600)}{d.content.length > 600 ? " …" : ""}</pre>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
          {q.data && !q.data.length && <p className="text-sm text-muted-foreground">Noch keine Dokumente.</p>}
        </div>
      )}
    </div>
  );
}
