// Adminmenue, Reiter "Termine".
//
// Alle Writes laufen ueber booking-admin (direkte Supabase-Writes gibt es im
// Adminbereich nicht). Die HERO-Zuordnung der Mitarbeiter und die Listen der
// HERO-Kategorien/Partner kommen aus admin-manage — also genau dieselben
// Aktionen, die der Reiter "Mitarbeiter" schon benutzt. Zwei Wege fuer
// dieselbe Sache waere die schlechtere Loesung.
//
// Aufbau in der Reihenfolge, in der man es einrichtet:
//   1. Terminarten (mehrere! Auswahl links, Einstellungen rechts)
//   2. Personal: Arbeitszeiten, Qualifikation, Standort, HERO-Zuordnung
//   3. Feiertage
//   4. Anfahrt
//   5. HERO und Mails
//   6. Kommende Termine und offene Mails

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarClock, CalendarDays, Car, Clock, Link2, Loader2, Mail,
  MapPin, Plus, RefreshCw, Trash2, Users,
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
  skills: string[] | null; home_base_address: string | null;
  home_base_lat: number | null; home_base_lng: number | null;
  heroPartnerId: number | null;
  workingHours: WorkingHour[];
}
interface RuleSetRow {
  id: string; key: string; label: string; active: boolean; duration_minutes: number;
  buffer_before_min: number; buffer_after_min: number; travel_buffer: boolean;
  min_notice_min: number; booking_window_days: number; slot_granularity_min: number;
  max_per_day_global: number | null; max_per_day_per_staff: number | null;
  requires_approval: boolean; required_skills: string[] | null;
  assignment_mode: string;
  categoryKey: string | null; categoryLabel: string | null; isBookable: boolean;
  staffIds: string[]; heroCategoryId: number | null;
}
interface CategoryRow { id: string; key: string; label: string; source: string; blocks_availability: boolean; is_bookable: boolean }
interface EmployeeRow { id: string; name: string; hero_partner_id: number | null; uebernommen: boolean }
interface HolidayRow { id: string; date: string; name: string; origin: string; active: boolean }
interface BookingRow {
  id: string; status: string; starts_at: string; ends_at: string;
  customer_name: string | null; address: string | null; cancel_reason: string | null;
  hero_event_ref: string | null; project_id: string | null;
  staff: { display_name: string } | null; rule_set: { label: string } | null;
}
interface QueueRow { id: string; kind: string; send_after: string; attempts: number; last_error: string | null }
interface Option { value: string; label: string }

const hhmm = (t: string) => (t || "").slice(0, 5);
const fmt = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone("Europe/Berlin").setLocale("de")
  .toFormat("ccc dd.LL. HH:mm");

export default function BookingTab({ adminToken }: { adminToken: string }) {
  const [laden, setLaden] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [ruleSets, setRuleSets] = useState<RuleSetRow[]>([]);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [heroAktiv, setHeroAktiv] = useState(false);
  const [routingKey, setRoutingKey] = useState(false);
  const [heroPartner, setHeroPartner] = useState<Option[]>([]);
  const [heroKategorien, setHeroKategorien] = useState<Option[]>([]);

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

  /** Dieselben Aktionen wie im Reiter "Mitarbeiter" — nicht nachgebaut. */
  const invokeAdmin = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-manage", {
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
      setRuleSets(cfg.ruleSets ?? []);
      setGewaehlt((g) => g ?? (cfg.ruleSets?.[0]?.key ?? null));
      setStaff(cfg.staff ?? []);
      setCategories(cfg.categories ?? []);
      setEmployees(cfg.employees ?? []);
      setHeroAktiv(!!cfg.heroAktiv);
      setRoutingKey(!!cfg.routingKeyVorhanden);

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

      if (cfg.heroAktiv) {
        // Listen aus HERO. Fehlschlag ist nicht schlimm: die Zuordnung laesst
        // sich dann nur nicht aus einer Liste waehlen.
        try {
          const [p, k] = await Promise.all([
            invokeAdmin("hero_list_options", { source: "hero_partners" }),
            invokeAdmin("hero_list_options", { source: "hero_calendar_categories" }),
          ]);
          setHeroPartner(p?.options ?? []);
          setHeroKategorien(k?.options ?? []);
        } catch { /* Handeingabe bleibt moeglich */ }
      }
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaden(false);
    }
  }, [invoke, invokeAdmin]);

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

  const art = ruleSets.find((r) => r.key === gewaehlt) ?? null;
  const setArt = (patch: Partial<RuleSetRow>) =>
    setRuleSets((list) => list.map((r) => r.key === gewaehlt ? { ...r, ...patch } : r));

  const speichereArt = () => mitBusy("art", async () => {
    if (!art) return;
    await invoke("set_rule_set", {
      key: art.key,
      patch: {
        label: art.label, active: art.active, duration_minutes: art.duration_minutes,
        buffer_before_min: art.buffer_before_min, buffer_after_min: art.buffer_after_min,
        travel_buffer: art.travel_buffer, min_notice_min: art.min_notice_min,
        booking_window_days: art.booking_window_days, slot_granularity_min: art.slot_granularity_min,
        max_per_day_global: art.max_per_day_global, max_per_day_per_staff: art.max_per_day_per_staff,
        requires_approval: art.requires_approval, required_skills: art.required_skills ?? [],
      },
      heroCategoryId: art.heroCategoryId ?? null,
    });
    await invoke("set_rule_set_staff", { key: art.key, staffIds: art.staffIds });
    toast.success(`„${art.label}“ gespeichert`);
    await ladeAlles();
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
    const d = data as any;
    toast.success(`${d.events} Termine gelesen, ${d.blocks} Sperren, ${d.removed} entfernt`);
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

  /** Alle Qualifikationen, die irgendwo vorkommen — damit man sie ankreuzen
   *  statt tippen kann. Tippfehler wie "aufmaß" vs. "aufmass" sind sonst
   *  unsichtbar und kosten einen halben Tag Suche. */
  const skillListe = useMemo(() => {
    const set = new Set<string>();
    for (const r of ruleSets) for (const q of r.required_skills ?? []) set.add(q);
    for (const s of staff) for (const q of s.skills ?? []) set.add(q);
    return [...set].sort();
  }, [ruleSets, staff]);

  const offeneMitarbeiter = employees.filter((e) => !e.uebernommen);
  const ohneHero = heroAktiv ? staff.filter((s) => s.active && !s.heroPartnerId) : [];

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
      {/* 1. Terminarten */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Terminarten
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Jede Terminart hat eigene Dauer, Puffer und Zuständige. Was hier „buchbar“ ist,
            kann der Kunde über den Terminlink auswählen.
          </p>

          <div className="border rounded-lg divide-y">
            {ruleSets.map((r) => (
              <button
                key={r.key}
                onClick={() => setGewaehlt(r.key)}
                className={`w-full text-left px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm
                  ${r.key === gewaehlt ? "bg-accent" : "hover:bg-muted/60"}`}
              >
                <span className="font-medium flex-1 min-w-[140px]">{r.label}</span>
                <span className="text-muted-foreground">{r.duration_minutes} Min.</span>
                {(r.required_skills ?? []).length > 0 && (
                  <span className="text-muted-foreground">
                    {(r.required_skills ?? []).join(", ")}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {r.staffIds.length > 0 ? `${r.staffIds.length} zugeordnet` : "alle passenden"}
                </span>
                {!r.active
                  ? <Badge variant="outline">aus</Badge>
                  : r.isBookable
                    ? <Badge variant="secondary">buchbar</Badge>
                    : <Badge variant="outline">nur intern</Badge>}
              </button>
            ))}
          </div>

          {art && (
            <div className="border rounded-lg p-3 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{art.label}</p>
                <Badge variant="outline" className="font-mono text-[11px]">{art.key}</Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Feld label="Bezeichnung" hilfe="So steht es auf der Buchungsseite und in der Mail.">
                  <Input value={art.label} onChange={(e) => setArt({ label: e.target.value })} />
                </Feld>
                <Feld label="Dauer (Minuten)">
                  <Input type="number" min={15} step={15} value={art.duration_minutes}
                    onChange={(e) => setArt({ duration_minutes: Number(e.target.value) })} />
                </Feld>
                <Feld label="Puffer davor (Min.)" hilfe="Zeit, die vor dem Termin frei bleiben muss.">
                  <Input type="number" min={0} step={5} value={art.buffer_before_min}
                    onChange={(e) => setArt({ buffer_before_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Puffer danach (Min.)">
                  <Input type="number" min={0} step={5} value={art.buffer_after_min}
                    onChange={(e) => setArt({ buffer_after_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Vorlaufzeit (Min.)" hilfe="1440 = frühestens morgen buchbar.">
                  <Input type="number" min={0} step={60} value={art.min_notice_min}
                    onChange={(e) => setArt({ min_notice_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Buchbar bis (Tage)">
                  <Input type="number" min={1} value={art.booking_window_days}
                    onChange={(e) => setArt({ booking_window_days: Number(e.target.value) })} />
                </Feld>
                <Feld label="Raster (Min.)" hilfe="Abstand der angebotenen Startzeiten.">
                  <Input type="number" min={5} step={5} value={art.slot_granularity_min}
                    onChange={(e) => setArt({ slot_granularity_min: Number(e.target.value) })} />
                </Feld>
                <Feld label="Max. Termine pro Tag" hilfe="Leer = unbegrenzt.">
                  <Input type="number" min={0} value={art.max_per_day_global ?? ""}
                    onChange={(e) => setArt({
                      max_per_day_global: e.target.value === "" ? null : Number(e.target.value),
                    })} />
                </Feld>
              </div>

              <div>
                <Label className="text-xs">Nötige Qualifikation</Label>
                <div className="flex flex-wrap gap-3 mt-1.5">
                  {skillListe.length === 0 && (
                    <span className="text-xs text-muted-foreground">Noch keine Qualifikationen angelegt.</span>
                  )}
                  {skillListe.map((q) => {
                    const an = (art.required_skills ?? []).includes(q);
                    return (
                      <label key={q} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={an} onCheckedChange={(v) => setArt({
                          required_skills: v
                            ? [...(art.required_skills ?? []), q]
                            : (art.required_skills ?? []).filter((x) => x !== q),
                        })} />
                        {q}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Nur wer alle angekreuzten Qualifikationen hat, wird für diese Terminart angeboten.
                </p>
              </div>

              <div>
                <Label className="text-xs">Wer macht das?</Label>
                <div className="flex flex-wrap gap-3 mt-1.5">
                  {staff.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={art.staffIds.includes(s.id)}
                        onCheckedChange={(v) => setArt({
                          staffIds: v
                            ? [...art.staffIds, s.id]
                            : art.staffIds.filter((x) => x !== s.id),
                        })}
                      />
                      {s.display_name}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Niemand angekreuzt = jeder mit der nötigen Qualifikation. Eine Auswahl schränkt
                  zusätzlich ein.
                </p>
              </div>

              {heroAktiv && (
                <Feld label="HERO-Kategorie für diesen Termin"
                  hilfe="Unter dieser Kategorie landet der Termin in HERO. Ohne Angabe gilt die allgemeine Einstellung weiter unten.">
                  <Select
                    value={art.heroCategoryId ? String(art.heroCategoryId) : "none"}
                    onValueChange={(v) => setArt({ heroCategoryId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger><SelectValue placeholder="— allgemeine Einstellung —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— allgemeine Einstellung —</SelectItem>
                      {art.heroCategoryId && !heroKategorien.some((o) => o.value === String(art.heroCategoryId)) && (
                        <SelectItem value={String(art.heroCategoryId)}>HERO-ID {art.heroCategoryId}</SelectItem>
                      )}
                      {heroKategorien.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Feld>
              )}

              <Schalter
                label="Anfahrt einrechnen"
                hilfe="Prüft, ob zwischen zwei Terminen genug Zeit für die Fahrt bleibt."
                checked={art.travel_buffer}
                onChange={(v) => setArt({ travel_buffer: v })}
              />
              <Schalter
                label="Termin muss bestätigt werden"
                hilfe="Aus: der Termin gilt sofort (so abgestimmt). An: er ist erst vorgemerkt."
                checked={art.requires_approval}
                onChange={(v) => setArt({ requires_approval: v })}
              />
              <Schalter
                label="Terminart aktiv"
                hilfe="Aus: wird nirgends angeboten, bestehende Termine bleiben."
                checked={art.active}
                onChange={(v) => setArt({ active: v })}
              />

              {art.active && !art.isBookable && (
                <p className="text-xs text-amber-700">
                  Die Kategorie „{art.categoryLabel ?? art.categoryKey}“ ist nicht als buchbar
                  markiert — diese Terminart taucht auf der Buchungsseite deshalb nicht auf.
                </p>
              )}

              <Button size="sm" disabled={busy === "art"} onClick={speichereArt}>
                {busy === "art" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Terminart speichern
              </Button>
            </div>
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

          {(() => {
            // Verlangt eine buchbare Terminart eine Qualifikation, die niemand
            // hat, findet der Kunde keine Zeiten und nichts sagt einem warum.
            const luecken = ruleSets.filter((r) =>
              r.active && r.isBookable && (r.required_skills ?? []).length > 0 &&
              !staff.some((s) => s.active && (r.required_skills ?? []).every((q) => (s.skills ?? []).includes(q))));
            if (luecken.length === 0) return null;
            return (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Für {luecken.map((r) => `„${r.label}“`).join(", ")} hat niemand die nötige
                Qualifikation. Solange das so ist, findet der Kunde dafür keine freien Zeiten.
              </div>
            );
          })()}

          {ohneHero.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {ohneHero.map((s) => s.display_name).join(", ")}{" "}
              {ohneHero.length === 1 ? "ist" : "sind"} nicht mit HERO verknüpft. Dann blockieren
              HERO-Termine dieser Person keine Zeiten, und unsere Termine landen in HERO ohne
              Zuständigen. Unten zuordnen.
            </div>
          )}

          {offeneMitarbeiter.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm">Noch nicht als Personal angelegt:</p>
              <div className="flex flex-wrap gap-2">
                {offeneMitarbeiter.map((e) => (
                  <Button
                    key={e.id} size="sm" variant="outline" disabled={busy === `emp-${e.id}`}
                    onClick={() => mitBusy(`emp-${e.id}`, async () => {
                      await invoke("sync_staff_from_employees", { employeeIds: [e.id] });
                      toast.success(`${e.name} übernommen (Mo–Fr 08–17 Uhr als Start)`);
                      await ladeAlles();
                    })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> {e.name}
                    {heroAktiv && !e.hero_partner_id && (
                      <span className="ml-1 text-[11px] text-muted-foreground">(ohne HERO)</span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch kein Personal angelegt.</p>
          ) : staff.map((s) => (
            <StaffKarte
              key={s.id} staff={s} busy={busy} skillListe={skillListe}
              heroAktiv={heroAktiv} heroPartner={heroPartner} routingKey={routingKey}
              onHeroPartner={async (wert) => mitBusy(`hero-${s.id}`, async () => {
                if (!s.employee_id) throw new Error("Dieses Personal hängt an keinem Mitarbeiter-Datensatz");
                await invokeAdmin("set_employee_hero_partner", {
                  employeeId: s.employee_id, heroPartnerId: wert,
                });
                setStaff((list) => list.map((x) =>
                  x.id === s.id ? { ...x, heroPartnerId: wert ? Number(wert) : null } : x));
                toast.success("HERO-Zuordnung gespeichert");
              })}
              onSpeichern={async (patch) => mitBusy(`staff-${s.id}`, async () => {
                const res = await invoke("staff_upsert", {
                  id: s.id, displayName: patch.display_name, active: patch.active,
                  employeeId: s.employee_id, homeBaseAddress: patch.home_base_address,
                  skills: patch.skills ?? [],
                });
                await invoke("set_working_hours", {
                  staffId: s.id,
                  hours: patch.workingHours.map((h) => ({
                    weekday: h.weekday, start: hhmm(h.start_time), end: hhmm(h.end_time),
                  })),
                });
                toast.success(patch.home_base_address && !res?.standortErkannt
                  ? "Gespeichert — die Adresse konnte aber keinem Standort zugeordnet werden"
                  : "Gespeichert");
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

      {/* 4. Anfahrt */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Car className="h-4 w-4" /> Anfahrt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!routingKey && (
            <p className="text-xs text-amber-700">
              Es ist kein Routing-Schlüssel hinterlegt (Supabase-Secret <code>ORS_API_KEY</code>).
              Bis dahin wird geschätzt, und Adressen können nicht in Koordinaten übersetzt werden —
              der Einsatzradius greift also noch nicht.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Feld label="Berechnung"
              hilfe="Schätzung rechnet Luftlinie x Umwegfaktor. Routing fragt echte Fahrzeiten ab.">
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
              hilfe="Liegt die Adresse weiter weg, wird der Mitarbeiter nicht angeboten. 0 = keine Grenze.">
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy === "settings"} onClick={speichereSettings}>
              {busy === "settings" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Speichern
            </Button>
            <Button size="sm" variant="outline" disabled={!routingKey || busy === "geo"}
              onClick={() => mitBusy("geo", async () => {
                const r = await invoke("geocode_staff");
                const offen = (r.bericht ?? []).filter((b: any) => !b.erkannt).map((b: any) => b.name);
                toast[offen.length ? "warning" : "success"](
                  offen.length ? `Nicht erkannt: ${offen.join(", ")}` : "Alle Standorte ermittelt");
                await ladeAlles();
              })}>
              <MapPin className="h-3.5 w-3.5 mr-1" /> Standorte aus den Adressen ermitteln
            </Button>
          </div>
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
          {!heroAktiv && (
            <p className="text-xs text-muted-foreground">
              Die HERO-Integration ist im Reiter „Integrationen“ abgeschaltet — die folgenden
              Einstellungen wirken erst, wenn sie an ist.
            </p>
          )}
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
            <Feld label="HERO-Kategorie (allgemein)"
              hilfe="Gilt für Terminarten ohne eigene Kategorie.">
              <Select
                value={settings.booking_hero_category_id || "none"}
                onValueChange={(v) => setzeSetting("booking_hero_category_id", v === "none" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="— keine —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— keine —</SelectItem>
                  {settings.booking_hero_category_id
                    && !heroKategorien.some((o) => o.value === settings.booking_hero_category_id) && (
                    <SelectItem value={settings.booking_hero_category_id}>
                      HERO-ID {settings.booking_hero_category_id}
                    </SelectItem>
                  )}
                  {heroKategorien.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
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

      {/* 6. Kommende Termine */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Kommende Termine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3.5 w-3.5" />
            Terminlink pro Projekt: <code className="px-1">/termin/&lt;Projekt-ID&gt;</code>
            {ruleSets.filter((r) => r.active && r.isBookable).length > 1
              && " — der Kunde wählt dort zuerst die Terminart"}
          </p>
          {bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Buchungen.</p>
          ) : (
            <div className="border rounded-lg divide-y">
              {bookings.map((b) => (
                <div key={b.id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tabular-nums font-medium">{fmt(b.starts_at)}</span>
                  <span className="text-muted-foreground">{b.rule_set?.label ?? ""}</span>
                  <span className="text-muted-foreground">{b.staff?.display_name ?? "—"}</span>
                  <span className="flex-1 min-w-[120px] truncate">{b.customer_name}</span>
                  {b.address && <span className="text-muted-foreground truncate max-w-[200px]">{b.address}</span>}
                  <Badge variant={b.status === "cancelled" ? "outline" : "secondary"}>
                    {b.status === "cancelled"
                      ? (b.cancel_reason === "customer" ? "vom Kunden abgesagt" : "abgesagt")
                      : b.status === "pending" ? "wartet" : "fest"}
                  </Badge>
                  {!b.hero_event_ref && b.status !== "cancelled" && heroAktiv && (
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

/** Ein Mitarbeiter mit Arbeitszeiten, Qualifikation, Standort und HERO-Bezug.
 *  Lokaler Zustand, damit beim Tippen nicht die ganze Seite neu rendert. */
function StaffKarte({
  staff, busy, skillListe, heroAktiv, heroPartner, routingKey,
  onSpeichern, onLoeschen, onHeroPartner,
}: {
  staff: StaffRow;
  busy: string | null;
  skillListe: string[];
  heroAktiv: boolean;
  heroPartner: Option[];
  routingKey: boolean;
  onSpeichern: (patch: StaffRow) => Promise<void>;
  onLoeschen: () => Promise<void>;
  onHeroPartner: (wert: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(staff.display_name);
  const [aktiv, setAktiv] = useState(staff.active);
  const [adresse, setAdresse] = useState(staff.home_base_address ?? "");
  const [skills, setSkills] = useState<string[]>(staff.skills ?? []);
  const [neuerSkill, setNeuerSkill] = useState("");
  const [hours, setHours] = useState<WorkingHour[]>(staff.workingHours ?? []);

  const perTag = (wd: number) => hours.find((h) => h.weekday === wd);
  const laufend = busy === `staff-${staff.id}`;
  const alleSkills = [...new Set([...skillListe, ...skills])].sort();

  function setzeTag(wd: number, an: boolean) {
    setHours((list) => an
      ? [...list.filter((h) => h.weekday !== wd), { weekday: wd, start_time: "08:00:00", end_time: "17:00:00" }]
      : list.filter((h) => h.weekday !== wd));
  }
  function setzeZeit(wd: number, feld: "start_time" | "end_time", wert: string) {
    setHours((list) => list.map((h) => h.weekday === wd ? { ...h, [feld]: `${wert}:00` } : h));
  }

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={aktiv} onCheckedChange={setAktiv} />
          <span className="text-xs text-muted-foreground">buchbar</span>
        </div>
      </div>

      {heroAktiv && (
        <div>
          <Label className="text-xs">HERO-Mitarbeiter</Label>
          <div className="flex items-center gap-2">
            <Select
              value={staff.heroPartnerId ? String(staff.heroPartnerId) : "none"}
              onValueChange={(v) => onHeroPartner(v === "none" ? null : v)}
            >
              <SelectTrigger className="h-9 max-w-[260px]">
                <SelectValue placeholder="Zuordnen…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Keine Zuordnung —</SelectItem>
                {staff.heroPartnerId && !heroPartner.some((o) => o.value === String(staff.heroPartnerId)) && (
                  <SelectItem value={String(staff.heroPartnerId)}>HERO-ID {staff.heroPartnerId}</SelectItem>
                )}
                {heroPartner.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {!staff.heroPartnerId && (
              <span className="text-[11px] text-amber-700">
                ohne Zuordnung blockieren HERO-Termine nicht
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Dieselbe Zuordnung wie im Reiter „Mitarbeiter“ — hier nur an der Stelle, wo sie zählt.
          </p>
        </div>
      )}

      <div>
        <Label className="text-xs">Startadresse für die Anfahrt</Label>
        <Input value={adresse} onChange={(e) => setAdresse(e.target.value)}
          placeholder="Straße Nr., PLZ Ort" />
        <p className="text-[11px] text-muted-foreground mt-1">
          {staff.home_base_lat != null
            ? "Standort erkannt — der Einsatzradius greift."
            : adresse
              ? routingKey
                ? "Noch kein Standort ermittelt. „Standorte aus den Adressen ermitteln“ unter Anfahrt."
                : "Ohne Routing-Schlüssel lässt sich daraus kein Standort ermitteln."
              : "Ohne Adresse wird dieser Mitarbeiter vom Einsatzradius nicht eingeschränkt."}
        </p>
      </div>

      <div>
        <Label className="text-xs">Qualifikationen</Label>
        <div className="flex flex-wrap items-center gap-3 mt-1.5">
          {alleSkills.map((q) => (
            <label key={q} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={skills.includes(q)}
                onCheckedChange={(v) => setSkills((list) =>
                  v ? [...list, q] : list.filter((x) => x !== q))}
              />
              {q}
            </label>
          ))}
          <div className="flex items-center gap-1">
            <Input
              value={neuerSkill} onChange={(e) => setNeuerSkill(e.target.value)}
              placeholder="neue Qualifikation" className="h-8 w-[160px]"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !neuerSkill.trim()) return;
                e.preventDefault();
                setSkills((l) => [...new Set([...l, neuerSkill.trim()])]);
                setNeuerSkill("");
              }}
            />
            <Button size="sm" variant="ghost" className="h-8" disabled={!neuerSkill.trim()}
              onClick={() => { setSkills((l) => [...new Set([...l, neuerSkill.trim()])]); setNeuerSkill(""); }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
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
            home_base_address: adresse.trim() || null,
            skills, workingHours: hours,
          })}>
          {laufend && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />} Speichern
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={laufend} onClick={onLoeschen}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Entfernen
        </Button>
      </div>
    </div>
  );
}
