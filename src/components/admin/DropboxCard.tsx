import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Link2, Unlink, FolderTree, CheckCircle, PlayCircle } from "lucide-react";

/**
 * Integrationen → Dropbox.
 *
 * Verbindet die Firmen-Dropbox (App-Key/Secret + einmaliger OAuth-Klick,
 * multi-tenant ready — keine Zugangsdaten im Code) und verwaltet die
 * Ordner-Einstellungen: Basis-Pfad, Namensmuster für Kunden-/Projektordner
 * und die Unterordner-Vorlage, die in jedem neuen Projektordner angelegt
 * wird. Das "Wann" steuern die Automationen (Trigger „HERO: Neues Projekt /
 * Neuer Kunde" + Aktionen „Dropbox: … anlegen").
 */

interface DropboxConfig {
  hasAppKey: boolean;
  hasAppSecret: boolean;
  connected: boolean;
  accountName: string | null;
  enabled: boolean;
  basePath: string;
  customerPattern: string;
  projectPattern: string;
  projectSubfolders: string;
}

export function DropboxCard({ adminToken }: { adminToken: string }) {
  const [cfg, setCfg] = useState<DropboxConfig | null>(null);
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [basePath, setBasePath] = useState("");
  const [customerPattern, setCustomerPattern] = useState("");
  const [projectPattern, setProjectPattern] = useState("");
  const [subfolders, setSubfolders] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.functions.invoke("dropbox-auth", {
      body: { action: "get_config", adminToken },
    });
    if (error || data?.error) { toast.error("Dropbox-Konfiguration konnte nicht geladen werden"); return; }
    const c = data as DropboxConfig;
    setCfg(c);
    setBasePath(c.basePath);
    setCustomerPattern(c.customerPattern);
    setProjectPattern(c.projectPattern);
    setSubfolders(c.projectSubfolders);
    setEnabled(c.enabled);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Rückkehr aus dem OAuth-Flow: ?dropbox=connected|denied|… auswerten.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("dropbox");
    if (!state) return;
    if (state === "connected") toast.success("Dropbox verbunden ✓");
    else toast.error(`Dropbox-Verbindung fehlgeschlagen (${state})`);
    params.delete("dropbox");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    if (state === "connected") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-auth", {
        body: {
          action: "set_config", adminToken,
          appKey: appKey.trim() || undefined,
          appSecret: appSecret.trim() || undefined,
          enabled,
          basePath, customerPattern, projectPattern, projectSubfolders: subfolders,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Dropbox-Einstellungen gespeichert");
      setAppKey(""); setAppSecret("");
      await load();
    } catch (e: any) {
      toast.error("Speichern fehlgeschlagen: " + (e?.message || ""));
    } finally { setSaving(false); }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-auth", {
        body: { action: "start", adminToken },
      });
      if (error || data?.error || !data?.url) throw new Error(data?.error || error?.message || "Keine Auth-URL");
      window.location.href = data.url; // Dropbox-Consent, kommt zurück auf /admin
    } catch (e: any) {
      toast.error("Verbinden fehlgeschlagen: " + (e?.message || ""));
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    const { data, error } = await supabase.functions.invoke("dropbox-auth", {
      body: { action: "disconnect", adminToken },
    });
    if (error || data?.error) { toast.error("Trennen fehlgeschlagen"); return; }
    toast.success("Dropbox-Verbindung getrennt");
    load();
  };

  // Manuell nach neuen HERO-Projekten/Kunden suchen (statt auf den
  // 10-Minuten-Zeitplan zu warten) - praktisch zum Testen.
  const runPollNow = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke("hero-dropbox-poll", {
        body: { adminToken },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.baseline) {
        toast.success(`Startabgleich abgeschlossen: ${data.markedProjects} Projekte / ${data.markedCustomers} Kunden als bekannt markiert. Ab jetzt werden nur NEUE erkannt.`);
      } else if (data?.skipped) {
        toast.info(`Übersprungen: ${data.reason}`);
      } else {
        toast.success(`Abgleich fertig: ${data.newProjects ?? 0} neue Projekte, ${data.newCustomers ?? 0} neue Kunden verarbeitet.`);
      }
    } catch (e: any) {
      toast.error("Abgleich fehlgeschlagen: " + (e?.message || ""));
    } finally { setPolling(false); }
  };

  const hasCreds = !!cfg?.hasAppKey && !!cfg?.hasAppSecret;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FolderTree className="h-5 w-5" /> Dropbox Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Legt bei neuen HERO-Projekten/-Kunden automatisch die Ordnerstruktur in eurer
          Dropbox an. Die Auslöser richtest du im Tab „Automationen" ein
          (Trigger „HERO: Neues Projekt / Neuer Kunde" → Aktion „Dropbox: … anlegen").
        </p>

        {!cfg ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lädt…</div>
        ) : (
          <>
            {/* Verbindung */}
            <div className="space-y-3">
              <p className="text-sm font-medium">1. Verbindung</p>
              {cfg.connected ? (
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 text-sm">
                  <span className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle className="h-4 w-4" /> Verbunden{cfg.accountName ? ` als ${cfg.accountName}` : ""}
                  </span>
                  <Button size="sm" variant="outline" onClick={disconnect}><Unlink className="h-3.5 w-3.5 mr-1" /> Trennen</Button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>App-Key</Label>
                    <Input value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder={cfg.hasAppKey ? "•••••• (gespeichert)" : "Dropbox App-Key"} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>App-Secret</Label>
                    <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={cfg.hasAppSecret ? "•••••• (gespeichert)" : "Dropbox App-Secret"} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Aus der Dropbox App Console (App mit „Full Dropbox"-Zugriff). Wird verschlüsselt
                    gespeichert und nie im Frontend angezeigt. Nach dem Speichern auf „Mit Dropbox verbinden" klicken.
                  </p>
                </div>
              )}
            </div>

            {/* Einstellungen */}
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">2. Ordner-Einstellungen</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Basis-Pfad</Label>
                  <Input value={basePath} onChange={(e) => setBasePath(e.target.value)} placeholder="/Geschäftliches/Kunden" />
                </div>
                <div className="space-y-1.5">
                  <Label>Kundenordner-Name</Label>
                  <Input value={customerPattern} onChange={(e) => setCustomerPattern(e.target.value)} placeholder="{kunde}" />
                  <p className="text-xs text-muted-foreground">Platzhalter: {"{kunde}"}, {"{kundennr}"}</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Projektordner-Name</Label>
                  <Input value={projectPattern} onChange={(e) => setProjectPattern(e.target.value)} placeholder="{projektnr} {projektname}" />
                  <p className="text-xs text-muted-foreground">Platzhalter: {"{projektnr}"}, {"{projektname}"}, {"{kunde}"}</p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Unterordner in jedem neuen Projektordner</Label>
                  <Textarea rows={6} value={subfolders} onChange={(e) => setSubfolders(e.target.value)} placeholder={"01 Aufmaß\n02 Layout\n03 Freigaben"} />
                  <p className="text-xs text-muted-foreground">Eine Zeile = ein Ordner. Verschachtelung mit „/" möglich, z.B. „04 Produktion/Druckdaten".</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} id="dbx-enabled" />
                <Label htmlFor="dbx-enabled" className="text-sm cursor-pointer">Integration aktivieren</Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Speichert…</> : "Speichern"}
              </Button>
              {!cfg.connected && hasCreds && (
                <Button variant="secondary" onClick={connect} disabled={connecting}>
                  {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />} Mit Dropbox verbinden
                </Button>
              )}
              {cfg.connected && (
                <Button variant="outline" onClick={runPollNow} disabled={polling}>
                  {polling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />} Jetzt abgleichen
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
