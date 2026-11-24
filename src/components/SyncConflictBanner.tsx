/**
 * Sync-Hinweise im Projekt: offline / wartende Aenderungen / Konflikte.
 *
 * Konflikt = dasselbe Feld (oder Foto) wurde hier UND auf einem anderen
 * Geraet unterschiedlich geaendert. Nichts wird still ueberschrieben: der
 * Mitarbeiter sieht beide Fassungen und entscheidet.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cachedQuery } from "@/lib/offlineCache";
import { getSyncDB, createImageId, createDetailBlobId, type SyncConflictRecord } from "@/lib/indexedDBStorage";
import { conflictImageUrl, hasPendingPush, listConflicts, onConflictsChanged, resolveConflict } from "@/lib/sync/engine";
import { displayValue, fieldLabel } from "@/lib/sync/fields";
import { subscribeToSyncState, type SyncState } from "@/lib/syncStatus";
import { toast } from "sonner";

export function SyncConflictBanner({ projectId }: { projectId: string }) {
  const [conflicts, setConflicts] = useState<SyncConflictRecord[]>([]);
  const [state, setState] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = () => listConflicts(projectId).then(setConflicts).catch(() => null);
    load();
    const off = onConflictsChanged((pid) => { if (!pid || pid === projectId) load(); });
    const offState = subscribeToSyncState(setState);
    return () => { off(); offState(); };
  }, [projectId]);

  useEffect(() => {
    if (conflicts.length === 0) { setOpen(false); return; }
    cachedQuery<any[]>("location_field_config:labels", () => supabase.from("location_field_config").select("field_key, field_label"))
      .then((rows) => setLabels(Object.fromEntries((rows || []).map((r: any) => [r.field_key, r.field_label]))))
      .catch(() => null);
  }, [conflicts.length]);

  const offline = state ? !state.isOnline : false;
  const pending = hasPendingPush(projectId) && (state?.pendingProjects ?? 0) > 0;

  return (
    <>
      {offline && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Kein Internet – alles wird auf dem Gerät gespeichert und automatisch hochgeladen, sobald wieder Netz da ist.</span>
        </div>
      )}
      {!offline && pending && (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/50 p-3 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>Änderungen werden hochgeladen…</span>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[12rem]">
            {conflicts.length === 1 ? "1 Änderung" : `${conflicts.length} Änderungen`} wurde{conflicts.length === 1 ? "" : "n"} gleichzeitig auf einem anderen Gerät gemacht. Bitte entscheiden, welche Fassung gilt.
          </span>
          <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>Entscheiden</Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gleichzeitige Änderungen</DialogTitle>
            <DialogDescription>
              Diese Stellen wurden hier und auf einem anderen Gerät unterschiedlich geändert. Alles andere wurde automatisch zusammengeführt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {conflicts.map((c) => (
              <ConflictRow key={c.key} conflict={c} labels={labels} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConflictRow({ conflict: c, labels }: { conflict: SyncConflictRecord; labels: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const isImage = c.field.startsWith("image.");
  const isDeleted = c.field === "deleted";

  const decide = async (choice: "mine" | "theirs") => {
    setBusy(true);
    try {
      await resolveConflict(c, choice);
    } catch {
      toast.error("Konnte nicht gespeichert werden");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="text-sm font-medium">
        {c.label || "Eintrag"} · {fieldLabel(c.field, labels)}
      </div>
      {isDeleted ? (
        <p className="text-sm text-muted-foreground">
          Wurde auf einem anderen Gerät gelöscht, hier aber noch geändert.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Version title="Deine Fassung (dieses Gerät)">
            {isImage ? <LocalImage conflict={c} /> : <ValueText value={c.mine} />}
          </Version>
          <Version title="Andere Fassung (online)">
            {isImage ? <RemoteImage conflict={c} /> : <ValueText value={c.theirs} />}
          </Version>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide("mine")}>
          {isDeleted ? "Wiederherstellen" : "Meine behalten"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("theirs")}>
          {isDeleted ? "Auch hier löschen" : "Andere übernehmen"}
        </Button>
      </div>
    </div>
  );
}

function Version({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <div className="mb-1 text-xs text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function ValueText({ value }: { value: unknown }) {
  return <div className="whitespace-pre-wrap break-words text-sm">{displayValue(value as any)}</div>;
}

function LocalImage({ conflict: c }: { conflict: SyncConflictRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    const slot = c.field.slice(6) as "annotated" | "original";
    (async () => {
      const db = await getSyncDB();
      const rec: any = c.kind === "location"
        ? await db.get("images", createImageId(c.id, slot))
        : await db.get("detail-image-blobs", createDetailBlobId(c.id, slot));
      if (rec?.blob) { objectUrl = URL.createObjectURL(rec.blob); setUrl(objectUrl); }
    })();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [c]);
  return url ? <img src={url} alt="Deine Fassung" className="max-h-48 w-full rounded object-contain" /> : <div className="text-sm text-muted-foreground">(kein Bild)</div>;
}

function RemoteImage({ conflict: c }: { conflict: SyncConflictRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { conflictImageUrl(c).then(setUrl).catch(() => setUrl(null)); }, [c]);
  return url ? <img src={url} alt="Andere Fassung" className="max-h-48 w-full rounded object-contain" /> : <div className="text-sm text-muted-foreground">(nur online sichtbar)</div>;
}
