// Spec E: Adminmenü „Archiv & Speicher“ – Speicherübersicht, Einstellungen, Vorschau/Testlauf, Ausführen, Fotos
// verkleinern, verwaiste Dateien, Protokoll.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { resizeArchivedPhotos, runCompaction } from "@/lib/browserImageResize";

interface Settings {
  autoArchiveDays: number; archiveWhenHeroDone: boolean; warnDaysBefore: number; customerAccessArchived: "readonly" | "full" | "none";
  compactAfterDays: number; imageMaxPx: number; imageQuality: number; keepOriginalPhotos: boolean;
  purgeSupersededVersions: boolean; deleteMeetingAudio: boolean; deletePrintFilesAfterDays: number;
}

const mb = (b: number) => `${(b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1)} MB`;
const FOLDER: Record<string, string> = {
  images: "Standortfotos", pdfs: "Druckdateien", "detail-images": "Detailbilder", "vehicle-images": "Fahrzeugbilder",
  "vehicle-measured": "Fahrzeug bemaßt", "vehicle-measured-images": "Fahrzeug bemaßt (alt)", "vehicle-layouts": "Fahrzeuglayouts",
  layouts: "Layouts", "floor-plans": "Grundrisse", "meeting-audio": "Besprechungs-Audio", "customer-uploads": "Kunden-Uploads", "design-briefings": "Gestaltung",
};
const ACTION: Record<string, string> = {
  resize: "verkleinert", delete_original: "Original gelöscht", delete_version: "alte Version gelöscht", delete_audio: "Audio gelöscht",
  delete_print: "Druckdatei gelöscht", delete_orphan: "verwaist gelöscht", error: "Fehler",
};

export default function ArchiveTab({ adminToken }: { adminToken: string }) {
  const invoke = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-manage", { body: { adminToken, action, ...params } });
    if (error) {
      const msg = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null);
      throw new Error(msg || data?.error || error.message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, [adminToken]);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [testRun, setTestRun] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<any[] | null>(null);
  const [log, setLog] = useState<any[] | null>(null);
  const [photo, setPhoto] = useState<{ done: number; saved: number; errors: number; remaining: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadStats = useCallback(() => invoke("storage_stats").then(setStats).catch((e) => toast.error(e.message)), [invoke]);
  const loadLog = useCallback(() => invoke("compaction_log").then((d) => setLog(d.entries || [])).catch(() => null), [invoke]);
  useEffect(() => {
    invoke("get_archive_settings").then((d) => setSettings(d.settings)).catch((e) => toast.error(e.message));
    loadStats();
    loadLog();
  }, [invoke, loadStats, loadLog]);

  useEffect(() => {
    if (!settings) return;
    const t = setTimeout(() => invoke("archive_preview", { settings }).then(setPreview).catch(() => null), 400);
    return () => clearTimeout(t);
  }, [settings, invoke]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => (s ? { ...s, [k]: v } : s));
  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try { const d = await invoke("set_archive_settings", { settings }); setSettings(d.settings); toast.success("Gespeichert"); }
    catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const run = async (dryRun: boolean) => {
    if (!dryRun && !confirm("Jetzt alle fälligen archivierten Projekte komprimieren? Gelöschte Originale/alte Versionen kommen nicht zurück.")) return;
    setBusy(dryRun ? "test" : "run");
    try {
      const r = await runCompaction(adminToken, { dryRun });
      if (dryRun) setTestRun(r);
      else toast.success(`Fertig: ${r.projects?.length || 0} Projekt(e), ${mb(r.saved || 0)} gespart${r.partial ? " – Rest beim nächsten Lauf" : ""}`);
      loadLog(); if (!dryRun) loadStats();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const shrinkPhotos = async () => {
    if (!confirm("Fotos fälliger archivierter Projekte jetzt verkleinern? Das läuft in diesem Browserfenster – bitte offen lassen.")) return;
    abortRef.current = new AbortController();
    setBusy("photos"); setPhoto({ done: 0, saved: 0, errors: 0, remaining: 0 });
    try {
      const r = await resizeArchivedPhotos(adminToken, { onProgress: setPhoto, signal: abortRef.current.signal });
      toast.success(`${r.done} Foto(s) geprüft, ${mb(r.saved)} gespart${r.errors ? `, ${r.errors} Fehler` : ""}`);
      loadLog(); loadStats();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); abortRef.current = null; }
  };

  const loadOrphans = () => invoke("storage_orphans_report").then((d) => setOrphans(d.groups || [])).catch((e) => toast.error(e.message));
  const deleteOrphans = async (g: any) => {
    if (!confirm(`${g.count} verwaiste Datei(en) im Ordner „${FOLDER[g.folder] || g.folder}“ (${mb(g.bytes)}) endgültig löschen?`)) return;
    setBusy(`orph-${g.folder}`);
    try { const r = await invoke("storage_orphans_delete", { prefixes: [g.folder] }); toast.success(`${r.deleted} Datei(en) gelöscht, ${mb(r.bytes)}`); loadOrphans(); loadStats(); loadLog(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const num = (k: keyof Settings, label: string, hint: string, unit = "Tage") => settings && (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="number" className="w-28" value={String(settings[k])} onChange={(e) => set(k, Number(e.target.value) as any)} />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  const sw = (k: keyof Settings, label: string, hint: string) => settings && (
    <label className="flex items-start gap-3">
      <Switch checked={!!settings[k]} onCheckedChange={(v) => set(k, v as any)} className="mt-0.5" />
      <span><span className="text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
    </label>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Speicher</CardTitle>
          <Button size="sm" variant="ghost" onClick={loadStats}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          {!stats ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm">Gesamt: <b>{mb(stats.total)}</b> · davon verwaist {mb(stats.orphanBytes)}</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr className="text-left">
                  <th className="py-1 pr-2">Ordner</th><th className="pr-2 text-right">aktiv</th><th className="pr-2 text-right">archiviert</th>
                  <th className="pr-2 text-right">komprimiert</th><th className="pr-2 text-right">sonstige</th><th className="pr-2 text-right">verwaist</th><th className="text-right">gesamt</th>
                </tr></thead>
                <tbody>{stats.folders.map((f: any) => (
                  <tr key={f.folder} className="border-t">
                    <td className="py-1 pr-2">{FOLDER[f.folder] || f.folder}</td>
                    <td className="pr-2 text-right">{mb(f.active)}</td><td className="pr-2 text-right">{mb(f.archived)}</td>
                    <td className="pr-2 text-right">{mb(f.compacted)}</td><td className="pr-2 text-right">{mb(f.other)}</td>
                    <td className="pr-2 text-right">{mb(f.orphan)}</td><td className="text-right font-medium">{mb(f.total)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Einstellungen</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!settings ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {num("autoArchiveDays", "Automatisch archivieren nach", "Ohne Aktivität (Standorte, Kommentare, Freigaben, Dateien). 0 = aus, sonst 14–3650.")}
                {num("warnDaysBefore", "Vorwarnung", "So viele Tage vorher zeigt die Projektliste „wird in n Tagen archiviert“.")}
                {num("compactAfterDays", "Komprimieren nach … im Archiv", "0 = nie, sonst 30–3650. Das Projekt bleibt vollständig ansehbar.")}
                {num("deletePrintFilesAfterDays", "Druckdateien entfernen nach … im Archiv", "0 = nie. Freigegebene Versionen bleiben immer erhalten.")}
                {num("imageMaxPx", "Fotos verkleinern auf", "Längere Kante, 1200–4000. 2000 px reicht für Bildschirm und A4-Druck.", "px")}
                {num("imageQuality", "Bildqualität", "JPEG-Qualität 50–90 (75 = kaum sichtbarer Unterschied).", "")}
              </div>
              <div className="space-y-3">
                {sw("archiveWhenHeroDone", "Archivieren, wenn das HERO-Projekt abgeschlossen ist", "Zusätzlich: verknüpftes HERO-Projekt nicht mehr offen und 14 Tage keine Aktivität.")}
                {sw("keepOriginalPhotos", "Originalfotos behalten", "Aus = Originale löschen, wenn ein bemaßtes Bild existiert (bemaßte Bilder werden nie gelöscht).")}
                {sw("purgeSupersededVersions", "Alte Dateiversionen löschen", "Außer der zuletzt freigegebenen – Freigabe-Nachweise bleiben.")}
                {sw("deleteMeetingAudio", "Besprechungs-Audio löschen", "Nur wenn ein Transkript existiert; Transkript und Zusammenfassung bleiben.")}
              </div>
              <div className="space-y-1">
                <Label>Kunde bei abgeschlossenen Projekten</Label>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={settings.customerAccessArchived}
                  onChange={(e) => set("customerAccessArchived", e.target.value as Settings["customerAccessArchived"])}>
                  <option value="readonly">nur ansehen (Standard)</option>
                  <option value="full">wie bisher (freigeben, kommentieren)</option>
                  <option value="none">nicht mehr sichtbar</option>
                </select>
              </div>
              <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Speichern</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Vorschau & Ausführen</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {preview && (
            <p>Mit diesen Einstellungen: <b>{preview.archive.length}</b> Projekt(e) würden archiviert, <b>{preview.compact.length}</b> komprimiert
              {preview.purgePrint.length ? <>, bei <b>{preview.purgePrint.length}</b> Druckdateien entfernt</> : null}.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => run(true)} disabled={!!busy}>{busy === "test" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Testlauf</Button>
            <Button onClick={() => run(false)} disabled={!!busy}>{busy === "run" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Jetzt ausführen</Button>
            {busy === "photos"
              ? <Button variant="destructive" onClick={() => abortRef.current?.abort()}>Fotos: anhalten</Button>
              : <Button variant="outline" onClick={shrinkPhotos} disabled={!!busy}>Fotos verkleinern</Button>}
          </div>
          <p className="text-xs text-muted-foreground">
            Testlauf ändert nichts und schätzt die Ersparnis. „Jetzt ausführen“ läuft auch jede Nacht automatisch (03:30) und löscht alte
            Versionen, Audio und – falls eingestellt – Originale und Druckdateien. Fotos verkleinert dieser Browser über „Fotos verkleinern“
            (die Bild-Umrechnung des Servers ist im Supabase-Tarif nicht aktiv).
          </p>
          {photo && <p className="text-xs">Fotos: {photo.done} geprüft · {mb(photo.saved)} gespart · {photo.errors} Fehler{photo.remaining ? ` · ${photo.remaining} offen` : ""}</p>}
          {testRun && (
            <div className="rounded border p-2 text-xs">
              <p className="mb-1 font-medium">Testlauf: geschätzt {mb(testRun.saved || 0)} gespart{testRun.partial ? " (Zeitlimit – nur ein Teil geprüft)" : ""}</p>
              {(testRun.projects || []).map((p: any) => (
                <p key={p.id}>{p.projectNumber}: {p.actions} Aktion(en), {mb(p.bytesBefore - p.bytesAfter)}{p.errors ? `, ${p.errors} Fehler` : ""}</p>
              ))}
              {!(testRun.projects || []).length && <p>Kein Projekt fällig.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Verwaiste Dateien</CardTitle>
          <Button size="sm" variant="outline" onClick={loadOrphans}>Bericht erstellen</Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">Dateien im Speicher, die keinem Datensatz mehr gehören und älter als 7 Tage sind. Gelöscht wird nur per Klick, je Ordner.</p>
          {orphans && !orphans.length && <p>Keine verwaisten Dateien.</p>}
          {orphans?.map((g) => (
            <details key={g.folder} className="rounded border p-2">
              <summary className="flex cursor-pointer items-center gap-2">
                <span className="flex-1">{FOLDER[g.folder] || g.folder}: {g.count} Datei(en), {mb(g.bytes)}</span>
                <Button size="sm" variant="destructive" disabled={!!busy} onClick={(e) => { e.preventDefault(); deleteOrphans(g); }}>
                  {busy === `orph-${g.folder}` && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Löschen
                </Button>
              </summary>
              <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                {g.files.map((f: any) => <li key={f.name} className="truncate">{f.name} · {mb(f.size)}</li>)}
                {g.count > g.files.length && <li>… und {g.count - g.files.length} weitere</li>}
              </ul>
            </details>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Protokoll</CardTitle>
          <Button size="sm" variant="ghost" onClick={loadLog}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          {!log ? <Loader2 className="h-5 w-5 animate-spin" /> : !log.length ? <p className="text-sm text-muted-foreground">Noch keine Einträge.</p> : (
            <div className="max-h-80 overflow-y-auto text-xs">
              {log.map((e) => (
                <div key={e.id} className="flex gap-2 border-t py-1">
                  <span className="shrink-0 text-muted-foreground">{new Date(e.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="shrink-0">{e.dry_run ? "Test · " : ""}{ACTION[e.action] || e.action}</span>
                  <span className="shrink-0 text-muted-foreground">{e.projects?.project_number || ""}</span>
                  <span className="min-w-0 flex-1 truncate" title={e.storage_path}>{e.error || e.storage_path}</span>
                  {e.bytes_before != null && <span className="shrink-0">{mb(e.bytes_before)}{e.bytes_after != null ? ` → ${mb(e.bytes_after)}` : ""}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
