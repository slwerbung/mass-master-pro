import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FolderInput } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { Badge, Button, ErrorBox, Select, Spinner } from "@/components/ui";
import { errorText, formatDateTime } from "@/lib/utils";

interface Targets {
  projectNr: string; projectName: string;
  folder: { path: string; source: "gemerkt" | "gefunden" | "neu" };
  subfolders: string[]; defaultSubfolder: string;
  attachments: { id: string; filename: string; mime: string; size: number; ignored: boolean; stored: boolean; savedPath: string | null; savedAt: string | null }[];
}

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Anhänge einer Mail per Klick in den Dropbox-Projektordner (über email-action, nur hinzufügen, nie überschreiben). */
export function DropboxSave({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dropbox", messageId], queryFn: () => invokeFn<Targets>("email-action", { action: "dropbox_targets", messageId }), retry: false });
  const [sub, setSub] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const t = q.data;
  useEffect(() => {
    if (!t) return;
    setSub(t.defaultSubfolder);
    setPicked(new Set(t.attachments.filter((a) => a.stored && !a.ignored && !a.savedPath).map((a) => a.id)));
  }, [t]);
  const save = useMutation({
    mutationFn: () => invokeFn<{ folder: string; files: string[]; created: boolean }>("email-action", { action: "dropbox_save", messageId, attachmentIds: [...picked], subfolder: sub }),
    onSuccess: (r) => {
      toast.success(`${r.files.length} Datei(en) in der Dropbox abgelegt: ${r.folder}${r.created ? " (Projektordner neu angelegt)" : ""}`);
      qc.invalidateQueries({ queryKey: ["dropbox", messageId] });
      qc.invalidateQueries({ queryKey: ["message", messageId] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const list = (t?.attachments ?? []).filter((a) => showHidden || !a.ignored);
  const hidden = (t?.attachments ?? []).filter((a) => a.ignored).length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/60 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium"><FolderInput className="h-4 w-4" /> Anhänge in die Dropbox</div>
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {t && (
        <>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Projektordner {t.projectNr}{t.folder.source === "neu" ? " – gibt es noch nicht, wird mit der Unterordner-Vorlage angelegt" : ""}</div>
            <div className="break-all font-mono text-xs">{t.folder.path}</div>
          </div>
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Unterordner</span>
            <Select className="h-8 w-auto" value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="">(direkt in den Projektordner)</option>
              {t.subfolders.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </label>
          <div className="space-y-1">
            {!list.length && <p className="text-muted-foreground">Keine Anhänge.</p>}
            {list.map((a) => (
              <label key={a.id} className="flex flex-wrap items-center gap-2">
                <input type="checkbox" disabled={!a.stored} checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                <span className={a.stored ? "" : "text-muted-foreground line-through"}>{a.filename}</span>
                <span className="text-xs text-muted-foreground">{kb(a.size)}</span>
                {!a.stored && <span className="text-xs text-muted-foreground">(nicht gespeichert – zu groß)</span>}
                {a.savedPath && <Badge variant="good" title={a.savedPath}><Check className="h-3 w-3" /> liegt in der Dropbox ({formatDateTime(a.savedAt)})</Badge>}
              </label>
            ))}
            {hidden > 0 && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? "Ausgeblendete verbergen" : `${hidden} ausgeblendete (Logos, Signaturbilder) zeigen`}
              </button>
            )}
          </div>
        </>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={!t || !picked.size || save.isPending}>
          {save.isPending && <Spinner />} {picked.size ? `${picked.size} Datei(en) ablegen` : "Ablegen"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Schließen</Button>
      </div>
      <p className="text-xs text-muted-foreground">Es wird nur hinzugefügt: Gibt es eine Datei schon, bekommt die neue eine Nummer angehängt. Nichts wird überschrieben oder gelöscht.</p>
    </div>
  );
}
