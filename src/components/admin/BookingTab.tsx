// Adminmenue, Reiter "Termine".
//
// Alle Writes laufen ueber die Edge Function booking-admin (direkte
// Supabase-Writes gibt es im Adminbereich nicht). Die Function laesst nur
// bekannte Einstellungsschluessel und Regelset-Spalten durch.
//
// Aufbau wie abgestimmt, von oben nach unten in der Reihenfolge, in der man es
// einrichtet: Terminart, Personal mit Arbeitszeiten, Feiertage, Fahrzeit,
// HERO/Mails. Darunter die kommenden Termine.

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarClock, CalendarDays, Car, Clock, Loader2, Mail, Plus, RefreshCw,
  Trash2, Users, Link2, AlertTriangle,
} from "lucide-react";

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const BUNDESLAENDER: [string, string][] = [
  ["BW", "Baden-Württemberg"], ["BY", "Bayern"], ["BE", "Berlin"], ["BB", "Brandenburg"],
  ["HB", "Bremen"], ["HH", "Hamburg"], ["HE", "Hessen"], ["MV", "Mecklenburg-Vorpommern"],
  ["NI", "Niedersachsen"], ["NW", "Nordrhein-Westfalen"], ["RP", "Rheinland-Pfalz"],
  ["SL", "Saarland"], ["SN", "Sachsen"], ["ST", "Sachsen-Anhalt"], ["SH", "Schleswig-Holstein"],
  ["TH", "Thüringen"],
];

interface WorkingHour { id?: string; staff_id?: string; weekday: number; start_time: string; end_time: string }
interface StaffRow {
  id: string; employee_id: string | null; display_name: string; active: boolean;
  skills: string[] | null; home_base_lat: number | null; home_base_lng: number | null;
  workingHours: WorkingHour[];
}
interface RuleSetRow {
  id: string; label: string; active: boolean; duration_minutes: number;
  buffer_before_min: number; buffer_after_min: number; travel_buffer: boolean;
  min_notice_min: number; booking_window_days: number; slot_granularity_min: number;
  max_per_day_global: number | null; max_per_day_per_staff: number | null;
  requires_approval: boolean; required_skills: string[] | null;
}
interface CategoryRow { key: string; label: string; source: string; blocks_availability: boolean }
interface EmployeeRow { id: string; name: string; hero_partner_id: number | null; uebernommen: boolean }
interface HolidayRow { id: string; date: string; name: string; origin: string; active: boolean }
interface BookingRow {
  id: string; status: string; starts_at: string; ends_at: string;
  customer_name: string | null; customer_email: string | null; address: string | null;
  cancel_reason: string | null; hero_event_ref: string | null; project_id: string | null;
  staff: { display_name: string } | null; rule_set: { label: string } | null;
}
interface QueueRow { id: string; kind: string; send_after: string; attempts: number; last_error: string | null }

const hhmm = (t: string) => (t || "").slice(0, 5);
const fmt = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone("Europe/Berlin").setLocale("de")
  .toFormat("ccc dd.LL. HH:mm");

export default function BookingTab({ adminToken }: { adminToken: string }) {
  const [laden, setLaden] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [ruleSet, setRuleSet] = useState<RuleSetRow | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);

  const [neuesDatum, setNeuesDatum] = useState("");
  const [neuerName, setNeuerName] = useState("");

  const invoke = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("booking-admin", {
      body: { adminToken, action, ...params },
    });
    if (error) throw new Error((data as any)?.error || error.message || "Netzwerkfehler");
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, [adminToken]);

  const bundesland = settings.booking_holiday_state || "BW";

  const ladeAlles = useCallback(async () => {
    setLaden(true);
    setFehler(null);
    try {
      const cfg = await invoke("get_config");
      setSettings(cfg.settings ?? {});
      setRuleSet(cfg.ruleSet ?? null);
      setStaff(cfg.staff ?? []);
      setCategories(cfg.categories ?? []);
      setEmployees(cfg.employees ?? []);
      const jahr = new Date().getFullYear();
      const [h, b, q] = await Promise.all([
        invoke("list_holidays", {
          state: cfg.settings?.booking_holiday_state || "BW",
          from: `${jahr}-01-01`, to: `${jahr + 1}-12-31`,
        }),
        invoke("list_bookings", { limit: 25 }),
        invoke("mail_queue"),
      ]);
      setHolidays(h.holidays ?? []);
      setBookings(b.bookings ?? []);
      setQueue(q.queue ?? []);
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaden(false);
    }
  }, [invoke]);

  useEffect(() => { if (adminToken) ladeAlles(); }, [adminToken, ladeAlles]);

  async function mitBusy(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  const setzeSetting = (key: string, value: string) => setSettings((s) => ({ ...s, [key]: value }));

  const speichereSettings = () => mitBusy("settings", async () => {
    await invoke("set_config", { values: settings });
    toast.success("Einstellungen gespeichert");
  });

  const speichereRuleSet = () => mitBusy("ruleset", async () => {
    if (!ruleSet) return;
    await invoke("set_rule_set", { patch: ruleSet });
    toast.success("Terminart gespeichert");
  });

  const importiereFeiertage = () => mitBusy("holidays", async () => {
    const jahr = new Date().getFullYear();
    const res = await invoke("import_holidays", { state: bundesland, years: [jahr, jahr + 1] });
    const teile = (res.report ?? []).map((r: any) =>
      r.error ? `${r.year}: ${r.error}` : `${r.year}: ${r.imported} Tage (${r.source})`);
    toast[res.ok ? "success" : "error"](teile.join(" · ") || "Nichts importiert");
    const h = await invoke("list_holidays", { state: bundesland, from: `${jahr}-01-01`, to: `${jahr + 1}-12-31` });
    setHolidays(h.holidays ?? []);
  });

  const heroAbgleich = () => mitBusy("sync", async () => {
    const { data, error } = await supabase.functions.invoke("booking-hero-sync", { body: { adminToken } });
    if (error) throw new Error((data as any)?.error || error.message);
    if ((data as any)?.skipped) { toast.info(String((data as any).skipped)); return; }
    if ((data as any)?.error) throw new Error((data as any).error);
    toast.success(`${(data as any).events} Termine gelesen, ${(data as any).blocks} Sperren, ${(data as any).removed} entfernt`);
    await ladeAlles();
  });

  const mailsJetzt = () => mitBusy("mails", async () => {
    const { data, error } = await supabase.functions.invoke("booking-mail", { body: { adminToken } });
    if (error) throw new Error((data as any)?.error || error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    const d = data as any;
    toast.success(`${d.sent ?? 0} verschickt, ${d.skipped ?? 0} übersprungen, ${d.failed ?? 0} fehlgeschlagen`);
    setQueue((await invoke("mail_queue")).queue ?? []);
  });

  const buchungsLink = useMemo(() => {
    const p = bookings.find((b) => b.project_id)?.project_id;
    return p ? `${window.location.origin}/termin/${p}` : null;
  }, [bookings]);

  if (laden) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <Loader2 className="h-4 w-4 animate-spin" /> Termin-Einstellungen werden geladen…
      </div>
    );
  }

  if (fehler) {
    return (
      <Card><CardContent className="py-8 space-y-3 text-center">
        <AlertTriangle className="h-7 w-7 mx-auto text-muted-foreground" />
        <p className="text-sm">{fehler}</p>
        <Button variant="outline" size="sm" onClick={ladeAlles}>Nochmal versuchen</Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Terminart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Terminart
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!ruleSet ? (
            <p className="text-sm text-muted-foreground">Keine Terminart eingerichtet.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Feld label="Bezeichnung" hilfe="So steht es auf der Buchungsseite und in der Mail.">
                  <Input value={ruleSet.label}
                    onChange={(e) => setRuleSet({ ...ruleSet, label: e.target.value })} />
                </Feld>
                <Feld label="Dauer (Minuten)">
                  <Input type="number" min={15} step={15} value={ruleSet.duration_minutes}
                    onChange={(e) => setRuleSet({ ...ruleSet, duration_minutes: Number(e.target.value) })} />
                </Feld>
                <Feld label="Puffer davor (Min.)" hilfe="Zeit, die vor dem Termin frei bleiben muss.">
                  <Input type="number" min={0} step={5} value={ruleSet.buffer_before_min}
                    onChange={(e) => setRuleSet({ ...ruleSet, buffer_before_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Puffer danach (Min.)">
                  <Input type="number" min={0} step={5} value={ruleSet.buffer_after_min}
                    onChange={(e) => setRuleSet({ ...ruleSet, buffer_after_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Vorlaufzeit (Min.)" hilfe="1440 = der Kunde kann frühestens morgen buchen.">
                  <Input type="number" min={0} step={60} value={ruleSet.min_notice_min}
                    onChange={(e) => setRuleSet({ ...ruleSet, min_notice_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Buchbar bis (Tage)">
                  <Input type="number" min={1} value={ruleSet.booking_window_days}
                    onChange={(e) => setRuleSet({ ...ruleSet, booking_window_days: Number(e.target.value) })} />
                </Feld>
                <Feld label="Raster (Min.)" hilfe="Im Abstand von 15 Min. werden Startzeiten angeboten.">
                  <Input type="number" min={5} step={5} value={ruleSet.slot_granularity_min}
                    onChange={(e) => setRuleSet({ ...ruleSet, slot_granularity_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Max. Termine pro Tag" hilfe="Leer = unbegrenzt.">
                  <Input type="number" min={0} value={ruleSet.max_per_day_global ?? ""}
                    onChange={(e) => setRuleSet({
                      ...ruleSet,
                      max_per_day_global: e.target.value === "" ? null : Number(e.target.value),
                    })} />
                </Feld>
              </div>
              <Schalter
                label="Anfahrt einrechnen"
                hilfe="Prüft, ob zwischen zwei Terminen genug Zeit für die Fahrt bleibt."
                checked={ruleSet.travel_buffer}
                onChange={(v) => setRuleSet({ ...ruleSet, travel_buffer: v })}
              />
              <Schalter
                label="Termin muss bestätigt werden"
                hilfe="Aus: der Termin gilt sofort (so abgestimmt). An: er ist erst vorgemerkt."
                checked={ruleSet.requires_approval}
                onChange={(v) => setRuleSet({ ...ruleSet, requires_approval: v })}
              />
              <Button size="sm" disabled={busy === "ruleset"} onClick={speichereRuleSet}>
                {busy === "ruleset" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Terminart speichern
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* 2. Personal */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Wer macht die Termine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ohne Personal mit Arbeitszeiten gibt es keine freien Zeiten. Die Sperrzeiten ergeben
            sich aus den Arbeitszeiten — eine zweite Liste gibt es bewusst nicht.
          </p>

          {employees.some((e) => !e.uebernommen && e.hero_partner_id) && (
            <div className="rounded-lg border p-3 text-sm flex items-center justify-between gap-3">
              <span>
                {employees.filter((e) => !e.uebernommen && e.hero_partner_id).length} Mitarbeiter mit
                HERO-Zuordnung sind noch nicht als Personal angelegt.
              </span>
              <Button size="sm" variant="outline" disabled={busy === "syncstaff"}
                onClick={() => mitBusy("syncstaff", async () => {
                  const r = await invoke("sync_staff_from_employees");
                  toast.success(`${r.angelegt} übernommen (Mo–Fr 08–17 Uhr als Start)`);
                  await ladeAlles();
                })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Übernehmen
              </Button>
            </div>
          )}

          {(() => {
            // Verlangt die Terminart eine Qualifikation, die niemand hat, gibt
            // es keine freien Zeiten — und nichts sagt einem warum. Genau das
            // ist beim Testlauf passiert.
            const noetig = ruleSet?.required_skills ?? [];
            if (noetig.length === 0) return null;
            const passt = staff.some((s) =>
              s.active && noetig.every((q) => (s.skills ?? []).includes(q)));
            if (passt) return null;
            return (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Die Terminart verlangt {noetig.map((q) => `\u201e${q}\u201c`).join(", ")} — das hat
                gerade niemand. Solange das so ist, findet der Kunde keine freien Zeiten.
                Trage die Qualifikation unten beim passenden Mitarbeiter ein.
              </div>
            );
          })()}

          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch kein Personal angelegt.</p>
          ) : staff.map((s) => (
            <StaffKarte
              key={s.id} staff={s} busy={busy}
              onSpeichern={async (patch) => mitBusy(`staff-${s.id}`, async () => {
                await invoke("staff_upsert", {
                  id: s.id, displayName: patch.display_name, active: patch.active,
                  employeeId: s.employee_id, homeBaseLat: patch.home_base_lat,
                  homeBaseLng: patch.home_base_lng, skills: patch.skills ?? [],
                });
                await invoke("set_working_hours", {
                  staffId: s.id,
                  hours: patch.workingHours.map((h) => ({
                    weekday: h.weekday, start: hhmm(h.start_time), end: hhmm(h.end_time),
                  })),
                });
                toast.success("Gespeichert");
                await ladeAlles();
              })}
              onLoeschen={async () => mitBusy(`staff-${s.id}`, async () => {
                const r = await invoke("staff_delete", { id: s.id });
                toast.success(r.deaktiviert ? `Abgeschaltet: ${r.grund}` : "Entfernt");
                await ladeAlles();
              })}
            />
          ))}
        </CardContent>
      </Card>

      {/* 3. Feiertage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Feiertage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Label className="text-xs">Bundesland</Label>
              <Select value={bundesland} onValueChange={(v) => setzeSetting("booking_holiday_state", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUNDESLAENDER.map(([k, name]) => <SelectItem key={k} value={k}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" disabled={busy === "holidays"} onClick={importiereFeiertage}>
              {busy === "holidays"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Dieses und nächstes Jahr holen
            </Button>
            <Button size="sm" variant="ghost" disabled={busy === "settings"} onClick={speichereSettings}>
              Bundesland speichern
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Die Tage kommen aus einer öffentlichen Quelle und bleiben danach bearbeitbar. Ein erneuter
            Import lässt eigene Einträge in Ruhe. Abgeschaltete Tage werden nicht wieder aktiviert.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Eigener Tag</Label>
              <Input type="date" value={neuesDatum} onChange={(e) => setNeuesDatum(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <Label className="text-xs">Bezeichnung</Label>
              <Input value={neuerName} onChange={(e) => setNeuerName(e.target.value)}
                placeholder="Betriebsurlaub, Brückentag" />
            </div>
            <Button size="sm" variant="outline" disabled={!neuesDatum || !neuerName.trim() || busy === "addhol"}
              onClick={() => mitBusy("addhol", async () => {
                await invoke("add_holiday", { state: bundesland, date: neuesDatum, name: neuerName.trim() });
                setNeuesDatum(""); setNeuerName("");
                const jahr = new Date().getFullYear();
                setHolidays((await invoke("list_holidays", {
                  state: bundesland, from: `${jahr}-01-01`, to: `${jahr + 1}-12-31`,
                })).holidays ?? []);
                toast.success("Eingetragen");
              })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Eintragen
            </Button>
          </div>

          {holidays.length > 0 && (
            <div className="border rounded-lg divide-y max-h-72 overflow-auto">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-24 tabular-nums text-muted-foreground">
                    {DateTime.fromISO(h.date).setLocale("de").toFormat("dd.LL.yyyy")}
                  </span>
                  <span className="flex-1 truncate">{h.name}</span>
                  {h.origin === "manual" && <Badge variant="secondary">eigener</Badge>}
                  <Switch checked={h.active} onCheckedChange={(v) => mitBusy(`hol-${h.id}`, async () => {
                    await invoke("set_holiday_active", { id: h.id, active: v });
                    setHolidays((list) => list.map((x) => x.id === h.id ? { ...x, active: v } : x));
                  })} />
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    onClick={() => mitBusy(`hol-${h.id}`, async () => {
                      await invoke("delete_holiday", { id: h.id });
                      setHolidays((list) => list.filter((x) => x.id !== h.id));
                    })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Fahrzeit */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Car className="h-4 w-4" /> Anfahrt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Feld label="Berechnung"
              hilfe="Schätzung rechnet Luftlinie x Umwegfaktor. Routing fragt echte Fahrzeiten ab (braucht den Schlüssel ORS_API_KEY in den Supabase-Secrets).">
              <Select value={settings.booking_travel_mode || "heuristic"}
                onValueChange={(v) => setzeSetting("booking_travel_mode", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="heuristic">Schätzung (ohne Schlüssel)</SelectItem>
                  <SelectItem value="routing">Echtes Routing</SelectItem>
                </SelectContent>
              </Select>
            </Feld>
            <Feld label="Einsatzradius (Min.)"
              hilfe="Liegt die Adresse weiter weg, wird der Mitarbeiter für diesen Termin nicht angeboten. 0 = keine Grenze. Braucht Standort-Koordinaten.">
              <Input type="number" min={0} step={5} value={settings.booking_travel_max_min ?? "45"}
                onChange={(e) => setzeSetting("booking_travel_max_min", e.target.value)} />
            </Feld>
            <Feld label="Durchschnitt km/h" hilfe="Nur für die Schätzung.">
              <Input value={settings.booking_travel_avg_kmh ?? "50"}
                onChange={(e) => setzeSetting("booking_travel_avg_kmh", e.target.value)} />
            </Feld>
            <Feld label="Umwegfaktor" hilfe="1,4 heißt: Straße ist 40 % länger als die Luftlinie.">
              <Input value={settings.booking_travel_detour ?? "1.4"}
                onChange={(e) => setzeSetting("booking_travel_detour", e.target.value)} />
            </Feld>
            <Feld label="Zuschlag (Min.)" hilfe="Parken, Suchen, Aufbauen.">
              <Input value={settings.booking_travel_overhead ?? "5"}
                onChange={(e) => setzeSetting("booking_travel_overhead", e.target.value)} />
            </Feld>
          </div>
          {(settings.booking_travel_mode === "routing") && (
            <p className="text-xs text-muted-foreground">
              Ohne hinterlegten Schlüssel fällt die Berechnung still auf die Schätzung zurück —
              die Terminsuche bleibt also in jedem Fall benutzbar.
            </p>
          )}
          <Button size="sm" disabled={busy === "settings"} onClick={speichereSettings}>
            {busy === "settings" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Speichern
          </Button>
        </CardContent>
      </Card>

      {/* 5. HERO und Mails */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> HERO und Mails
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Schalter
            label="Termine nach HERO schreiben"
            hilfe="Der gebuchte Termin wird am HERO-Projekt angelegt."
            checked={settings.booking_hero_write !== "false"}
            onChange={(v) => setzeSetting("booking_hero_write", v ? "true" : "false")}
          />
          <Schalter
            label="HERO-Termine als belegt lesen"
            hilfe="Bestehende Termine aus HERO blockieren freie Zeiten. Läuft alle 10 Minuten."
            checked={settings.booking_hero_read !== "false"}
            onChange={(v) => setzeSetting("booking_hero_read", v ? "true" : "false")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Feld label="HERO-Kategorie (ID)" hilfe="Kategorie, unter der unsere Termine in HERO landen.">
              <Input value={settings.booking_hero_category_id ?? ""}
                onChange={(e) => setzeSetting("booking_hero_category_id", e.target.value)} />
            </Feld>
            <Feld label="Interne Benachrichtigung an">
              <Input value={settings.booking_notify_internal ?? ""}
                onChange={(e) => setzeSetting("booking_notify_internal", e.target.value)} />
            </Feld>
            <Feld label="Erinnerung (Stunden vorher)" hilfe="0 = keine Erinnerung.">
              <Input type="number" min={0} value={settings.booking_reminder_hours ?? "24"}
                onChange={(e) => setzeSetting("booking_reminder_hours", e.target.value)} />
            </Feld>
            <Feld label="HERO-Vorschau (Tage)" hilfe="Wie weit nach vorne HERO-Termine gelesen werden.">
              <Input type="number" min={1} value={settings.booking_hero_sync_days ?? "60"}
                onChange={(e) => setzeSetting("booking_hero_sync_days", e.target.value)} />
            </Feld>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy === "settings"} onClick={speichereSettings}>
              {busy === "settings" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Speichern
            </Button>
            <Button size="sm" variant="outline" disabled={busy === "sync"} onClick={heroAbgleich}>
              {busy === "sync"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              HERO jetzt abgleichen
            </Button>
            <Button size="sm" variant="outline" disabled={busy === "mails"} onClick={mailsJetzt}>
              {busy === "mails"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <Mail className="h-3.5 w-3.5 mr-1" />}
              Offene Mails jetzt senden
            </Button>
          </div>

          {categories.filter((c) => c.source === "hero").length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium">Welche HERO-Kategorien blockieren Zeit?</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Neue Kategorien blockieren erst einmal — das ist die sichere Richtung.
                </p>
                <div className="border rounded-lg divide-y">
                  {categories.filter((c) => c.source === "hero").map((c) => (
                    <div key={c.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="flex-1 truncate">{c.label}</span>
                      <Switch checked={c.blocks_availability}
                        onCheckedChange={(v) => mitBusy(`cat-${c.key}`, async () => {
                          await invoke("set_category_blocks", { key: c.key, blocks: v });
                          setCategories((list) => list.map((x) =>
                            x.key === c.key ? { ...x, blocks_availability: v } : x));
                        })} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {queue.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium">Offene Mails ({queue.length})</p>
                <div className="border rounded-lg divide-y mt-2 max-h-48 overflow-auto">
                  {queue.map((q) => (
                    <div key={q.id} className="px-3 py-2 text-sm flex items-center gap-3">
                      <Badge variant="outline">{q.kind}</Badge>
                      <span className="text-muted-foreground">{fmt(q.send_after)}</span>
                      {q.attempts > 0 && <span className="text-destructive text-xs">{q.attempts} Versuche</span>}
                      {q.last_error && <span className="truncate text-xs text-muted-foreground">{q.last_error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Kommende Termine */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Kommende Termine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {buchungsLink && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Link2 className="h-3.5 w-3.5" />
              Buchungslink pro Projekt: <code className="px-1">/termin/&lt;Projekt-ID&gt;</code>
            </p>
          )}
          {bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Buchungen.</p>
          ) : (
            <div className="border rounded-lg divide-y">
              {bookings.map((b) => (
                <div key={b.id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tabular-nums font-medium">{fmt(b.starts_at)}</span>
                  <span className="text-muted-foreground">{b.staff?.display_name ?? "—"}</span>
                  <span className="flex-1 min-w-[120px] truncate">{b.customer_name}</span>
                  {b.address && <span className="text-muted-foreground truncate max-w-[220px]">{b.address}</span>}
                  <Badge variant={b.status === "cancelled" ? "outline" : "secondary"}>
                    {b.status === "cancelled"
                      ? (b.cancel_reason === "customer" ? "vom Kunden abgesagt" : "abgesagt")
                      : b.status === "pending" ? "wartet" : "fest"}
                  </Badge>
                  {!b.hero_event_ref && b.status !== "cancelled" && (
                    <Badge variant="outline" className="text-amber-700 border-amber-300">nicht in HERO</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── kleine Bausteine ──

function Feld({ label, hilfe, children }: { label: string; hilfe?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
      {hilfe && <p className="text-[11px] text-muted-foreground mt-1">{hilfe}</p>}
    </div>
  );
}

function Schalter({ label, hilfe, checked, onChange }: {
  label: string; hilfe?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hilfe && <p className="text-xs text-muted-foreground">{hilfe}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Ein Mitarbeiter mit seinen Arbeitszeiten. Lokaler Zustand, damit beim
 *  Tippen nicht die ganze Seite neu rendert. */
function StaffKarte({ staff, busy, onSpeichern, onLoeschen }: {
  staff: StaffRow;
  busy: string | null;
  onSpeichern: (patch: StaffRow) => Promise<void>;
  onLoeschen: () => Promise<void>;
}) {
  const [name, setName] = useState(staff.display_name);
  const [aktiv, setAktiv] = useState(staff.active);
  const [lat, setLat] = useState(staff.home_base_lat?.toString() ?? "");
  const [lng, setLng] = useState(staff.home_base_lng?.toString() ?? "");
  const [skills, setSkills] = useState((staff.skills ?? []).join(", "));
  const [hours, setHours] = useState<WorkingHour[]>(staff.workingHours ?? []);

  const perTag = (wd: number) => hours.find((h) => h.weekday === wd);

  function setzeTag(wd: number, an: boolean) {
    setHours((list) => an
      ? [...list.filter((h) => h.weekday !== wd), { weekday: wd, start_time: "08:00:00", end_time: "17:00:00" }]
      : list.filter((h) => h.weekday !== wd));
  }
  function setzeZeit(wd: number, feld: "start_time" | "end_time", wert: string) {
    setHours((list) => list.map((h) => h.weekday === wd ? { ...h, [feld]: `${wert}:00` } : h));
  }

  const laufend = busy === `staff-${staff.id}`;

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-28">
          <Label className="text-xs">Breite</Label>
          <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="48.83" />
        </div>
        <div className="w-28">
          <Label className="text-xs">Länge</Label>
          <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="9.32" />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={aktiv} onCheckedChange={setAktiv} />
          <span className="text-xs text-muted-foreground">buchbar</span>
        </div>
      </div>

      <div>
        <Label className="text-xs">Qualifikationen</Label>
        <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="aufmass, montage" />
        <p className="text-[11px] text-muted-foreground mt-1">
          Mehrere durch Komma trennen. Die Terminart oben bestimmt, welche noetig sind.
        </p>
      </div>

      <div className="grid gap-1.5">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
          const h = perTag(wd);
          return (
            <div key={wd} className="flex items-center gap-2 text-sm">
              <Switch checked={!!h} onCheckedChange={(v) => setzeTag(wd, v)} />
              <span className="w-24 text-muted-foreground">{WOCHENTAGE[wd]}</span>
              {h ? (
                <>
                  <Input type="time" className="w-28" value={hhmm(h.start_time)}
                    onChange={(e) => setzeZeit(wd, "start_time", e.target.value)} />
                  <span className="text-muted-foreground">bis</span>
                  <Input type="time" className="w-28" value={hhmm(h.end_time)}
                    onChange={(e) => setzeZeit(wd, "end_time", e.target.value)} />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">frei</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={laufend}
          onClick={() => onSpeichern({
            ...staff, display_name: name, active: aktiv,
            home_base_lat: lat === "" ? null : Number(lat),
            home_base_lng: lng === "" ? null : Number(lng),
            skills: skills.split(",").map((x) => x.trim()).filter(Boolean),
            workingHours: hours,
          })}>
          {laufend && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Speichern
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={laufend} onClick={onLoeschen}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Entfernen
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ohne Koordinaten greift der Einsatzradius für diesen Mitarbeiter nicht — er wird dann immer
        angeboten, statt dass eine fehlende Angabe ihn aussortiert.
      </p>
    </div>
  );
}
