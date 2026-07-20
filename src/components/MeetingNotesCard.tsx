import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mic, Square, Loader2, FileText, CheckCircle2, ChevronRight, Pencil, Save, Mail } from "lucide-react";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { useMeetingRecorder, MeetingMarkdown } from "@/components/MeetingRecorder";
import { SendProtocolDialog } from "@/components/SendProtocolDialog";
import { buildProtocolEmailBody } from "@/lib/protocolText";

interface Note {
  id: string;
  summary: string;
  action_plan: string;
  created_by: string | null;
  hero_logged: boolean;
  created_at: string;
}

export function MeetingNotesCard({ projectId, projectNumber }: { projectId: string; projectNumber: string }) {
  const { phase, activeProjectId, elapsedSec, start, stop } = useMeetingRecorder();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editActionPlan, setEditActionPlan] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const openNote = (n: Note) => { setEditing(false); setOpen(n); };

  const startEdit = () => {
    if (!open) return;
    setEditSummary(open.summary || "");
    setEditActionPlan(open.action_plan || "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!open) return;
    setSaving(true);
    try {
      const session = getSession();
      const { data, error } = await supabase.functions.invoke("meeting-notes", {
        body: { action: "update", token: session?.authToken, id: open.id, summary: editSummary, actionPlan: editActionPlan },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as any;
      const updated: Note = { ...open, summary: d?.summary ?? editSummary, action_plan: d?.actionPlan ?? editActionPlan, hero_logged: d?.heroLogged ?? open.hero_logged };
      setOpen(updated);
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      setEditing(false);
      if (d?.heroLogged) toast.success("Gespeichert & im HERO-Logbuch aktualisiert");
      else if (d?.heroError) toast.success("Gespeichert · HERO: " + d.heroError);
      else toast.success("Gespeichert");
    } catch (e: any) {
      toast.error("Speichern fehlgeschlagen: " + (e.message || "Unbekannter Fehler"));
    } finally {
      setSaving(false);
    }
  };

  const isThisRecording = phase === "recording" && activeProjectId === projectId;
  const isThisProcessing = phase === "processing" && activeProjectId === projectId;
  const busyElsewhere = phase !== "idle" && activeProjectId !== projectId;

  const load = useCallback(async () => {
    try {
      const session = getSession();
      const { data } = await supabase.functions.invoke("meeting-notes", {
        body: { action: "list", token: session?.authToken, projectId },
      });
      setNotes(((data as any)?.notes || []) as Note[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Refresh when a new note finished processing for this project.
  useEffect(() => {
    const onCreated = (e: Event) => {
      if ((e as CustomEvent).detail?.projectId === projectId) load();
    };
    window.addEventListener("meeting-note-created", onCreated as EventListener);
    return () => window.removeEventListener("meeting-note-created", onCreated as EventListener);
  }, [projectId, load]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Mic className="h-3.5 w-3.5" /> Gesprächsnotizen
          </p>
          {isThisRecording ? (
            <Button size="sm" variant="destructive" className="gap-1.5" onClick={stop}>
              <Square className="h-3.5 w-3.5" /> Stopp ({fmt(elapsedSec)})
            </Button>
          ) : isThisProcessing ? (
            <Button size="sm" variant="outline" disabled className="gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Wird erstellt…
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busyElsewhere} onClick={() => start(projectId, projectNumber)}>
              <Mic className="h-3.5 w-3.5" /> Gespräch aufnehmen
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Nimmt das Gespräch auf (läuft im Hintergrund weiter), transkribiert es und legt ein Ergebnisprotokoll + Maßnahmenplan an – auch im HERO-Logbuch.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Lädt…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Notizen.</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <button
                key={n.id}
                onClick={() => openNote(n)}
                className="w-full text-left flex items-start gap-2 rounded-lg border bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
              >
                <FileText className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{firstLine(n.summary)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeSafe(n.created_at)}{n.created_by ? ` · ${n.created_by}` : ""}
                    {n.hero_logged ? " · HERO ✓" : ""}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Gesprächsnotiz</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {formatDateTimeSafe(open.created_at)}{open.created_by ? ` · ${open.created_by}` : ""}
                {open.hero_logged && <span className="inline-flex items-center gap-1 ml-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> HERO-Logbuch</span>}
              </p>

              {editing ? (
                <>
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ergebnisprotokoll</p>
                    <Textarea value={editSummary} onChange={(e) => setEditSummary(e.target.value)} rows={7} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Maßnahmenplan</p>
                    <Textarea value={editActionPlan} onChange={(e) => setEditActionPlan(e.target.value)} rows={6} className="text-sm" />
                    <p className="text-xs text-muted-foreground">Jede Maßnahme in eine eigene Zeile mit „- " am Anfang.</p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Abbrechen</Button>
                    <Button onClick={saveEdit} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />} Speichern
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Ergebnisprotokoll</p>
                    <MeetingMarkdown text={open.summary} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Maßnahmenplan</p>
                    <MeetingMarkdown text={open.action_plan} />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={startEdit}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Bearbeiten
                    </Button>
                    <Button size="sm" onClick={() => setSendOpen(true)}>
                      <Mail className="h-3.5 w-3.5 mr-1.5" /> An Kunden senden
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {open && (
        <SendProtocolDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          projectId={projectId}
          defaultSubject={`Protokoll · Projekt ${projectNumber}`}
          defaultBody={buildProtocolEmailBody({ summary: open.summary, actionPlan: open.action_plan })}
        />
      )}
    </Card>
  );
}

function firstLine(s: string): string {
  const line = (s || "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "Gesprächsnotiz";
  return line.replace(/^[-•]\s*/, "").replace(/^#+\s*/, "");
}
