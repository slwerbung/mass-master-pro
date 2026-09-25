// Oeffentliche Buchungsseite: /termin/:projectId
//
// Aufmachung an Calendly angelehnt (so gewuenscht): links steht, worum es geht,
// rechts waehlt man Tag und Uhrzeit, danach die Bestaetigung. Der Link haengt
// an EINEM Projekt — Adresse und Kontakt kommen aus HERO und sind editierbar.
//
// Gerechnet wird nichts hier: welche Zeiten frei sind, entscheidet der Server,
// und beim Buchen rechnet er den Tag noch einmal neu. Das Frontend darf sich
// also irren, ohne dass daraus ein doppelt vergebener Termin wird.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays, CheckCircle2, Clock, Loader2, MapPin, Pencil, User, ArrowLeft, AlertTriangle,
} from "lucide-react";
import {
  createBooking, loadAvailability, loadBookingContext,
  type AppointmentType, type BookingContext, type Slot,
} from "@/lib/bookingApi";

const TZ = "Europe/Berlin";
const dayKey = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(TZ).toFormat("yyyy-MM-dd");
const timeLabel = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(TZ).toFormat("HH:mm");

export default function BookingPage() {
  const { projectId = "" } = useParams();

  const [ctx, setCtx] = useState<BookingContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Terminart: bei genau einer wird sie sofort gesetzt, bei mehreren waehlt
  // der Kunde zuerst (wie bei Calendly die Event-Typen).
  const [art, setArt] = useState<AppointmentType | null>(null);

  const [month, setMonth] = useState<Date>(new Date());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // Adresse: aus HERO vorbelegt, auf Wunsch aenderbar. Eine Aenderung wirkt
  // sich auf die Fahrzeiten aus, deshalb wird danach neu gerechnet.
  const [editAddress, setEditAddress] = useState(false);
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [addressApplied, setAddressApplied] = useState(0);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [hinweis, setHinweis] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ startsAt: string; endsAt: string } | null>(null);

  // ── Kontext laden ──
  useEffect(() => {
    let alive = true;
    loadBookingContext(projectId)
      .then((c) => {
        if (!alive) return;
        setCtx(c);
        if (c.appointments.length === 1) setArt(c.appointments[0]);
        setStreet(c.address?.street || "");
        setZip(c.address?.zipcode || "");
        setCity(c.address?.city || "");
        setName(c.contact.name || c.project.customerName || "");
        setEmail(c.contact.email || "");
        setPhone(c.contact.phone || "");
        if (!c.address) setEditAddress(true);
      })
      .catch((e) => alive && setLoadError(e.message || "Die Buchungsseite konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [projectId]);

  // ── Freie Zeiten fuer den sichtbaren Monat ──
  const range = useMemo(() => {
    const start = DateTime.fromJSDate(month).setZone(TZ).startOf("month");
    const now = DateTime.now().setZone(TZ);
    const from = start < now ? now.startOf("hour") : start;
    return { from: from.toUTC().toISO()!, to: start.endOf("month").toUTC().toISO()! };
  }, [month]);

  const fetchSlots = useCallback(async () => {
    if (!ctx || !art) return;
    setLoadingSlots(true);
    try {
      const res = await loadAvailability(projectId, art.key, range.from, range.to,
        editAddress || addressApplied ? { street, zip, city } : undefined);
      setSlots(res.slots || []);
    } catch (e) {
      setSlots([]);
      setSubmitError((e as Error).message);
    } finally {
      setLoadingSlots(false);
    }
    // street/zip/city bewusst NICHT in den Abhaengigkeiten: es soll erst beim
    // Uebernehmen neu gerechnet werden, nicht bei jedem Tastendruck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, art, projectId, range.from, range.to, addressApplied]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = dayKey(s.startsAt);
      const list = map.get(k) || [];
      list.push(s);
      map.set(k, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [slots]);

  const freeDays = useMemo(
    () => [...slotsByDay.keys()].map((k) => DateTime.fromISO(k, { zone: TZ }).toJSDate()),
    [slotsByDay],
  );

  // Ersten freien Tag vorauswaehlen, damit die Seite nicht leer wirkt.
  useEffect(() => {
    if (selectedDay && slotsByDay.has(selectedDay)) return;
    const first = [...slotsByDay.keys()].sort()[0];
    setSelectedDay(first ?? null);
    setSelectedSlot(null);
  }, [slotsByDay, selectedDay]);

  const daySlots = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];
  const addressText = [street, [zip, city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  async function submit() {
    if (!selectedSlot || !ctx || !art) return;
    setSubmitError(null);
    if (!name.trim() || !email.trim()) {
      setSubmitError("Bitte Name und E-Mail angeben.");
      return;
    }
    const staffId = selectedSlot.assignedStaffId || selectedSlot.staffIds?.[0];
    if (!staffId) {
      setSubmitError("Zu diesem Termin fehlt die Zuordnung. Bitte einen anderen wählen.");
      return;
    }
    setSubmitting(true);
    try {
      await createBooking({
        project: projectId,
        ruleSet: art.key,
        slot: { startsAt: selectedSlot.startsAt, endsAt: selectedSlot.endsAt },
        staffId,
        contact: { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined },
        addressOverride: addressApplied || editAddress ? { street, zip, city } : null,
        hinweis: hinweis.trim() || undefined,
      });
      setDone({ startsAt: selectedSlot.startsAt, endsAt: selectedSlot.endsAt });
    } catch (e) {
      // 409 heisst: in der Zwischenzeit vergeben. Dann neu laden, damit der
      // Kunde sofort sieht, was noch frei ist.
      setSubmitError((e as Error).message);
      await fetchSlots();
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Zustaende ──
  if (loadError) {
    return (
      <Shell>
        <Card><CardContent className="py-10 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="font-medium">Dieser Buchungslink funktioniert nicht.</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <p className="text-sm text-muted-foreground">Bitte antworten Sie einfach auf unsere E-Mail, wir finden gemeinsam einen Termin.</p>
        </CardContent></Card>
      </Shell>
    );
  }

  if (!ctx) {
    return (
      <Shell>
        <div className="py-20 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Termine werden geladen…
        </div>
      </Shell>
    );
  }

  if (done) {
    const d = DateTime.fromISO(done.startsAt, { zone: "utc" }).setZone(TZ).setLocale("de");
    return (
      <Shell>
        <Card><CardContent className="py-10 text-center space-y-4">
          <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600" />
          <div>
            <p className="text-lg font-semibold">Termin steht</p>
            <p className="text-muted-foreground">
              {d.toFormat("cccc, d. LLLL yyyy")} um {timeLabel(done.startsAt)} – {timeLabel(done.endsAt)} Uhr
            </p>
          </div>
          {addressText && <p className="text-sm text-muted-foreground">{addressText}</p>}
          <p className="text-sm text-muted-foreground">
            Sie bekommen gleich eine Bestätigung per E-Mail, mit Kalendereintrag zum Hinzufügen.
            Falls es doch nicht passt, können Sie den Termin über den Link in der Mail absagen.
          </p>
        </CardContent></Card>
      </Shell>
    );
  }

  // Mehrere Terminarten: erst waehlen, dann der Kalender. Bei genau einer
  // Terminart ist sie oben schon gesetzt, dieser Schritt entfaellt also.
  if (!art) {
    return (
      <Shell>
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">SL WERBUNG</p>
              <h1 className="text-xl font-semibold leading-tight mt-1">Termin vereinbaren</h1>
              {ctx.project.number && (
                <p className="text-sm text-muted-foreground mt-1">Projekt {ctx.project.number}</p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Worum geht es?</p>
            <div className="grid gap-2">
              {ctx.appointments.map((a) => (
                <button
                  key={a.key}
                  onClick={() => { setArt(a); setSelectedSlot(null); setSelectedDay(null); }}
                  className="text-left rounded-lg border p-3 hover:bg-accent transition-colors"
                >
                  <span className="font-medium">{a.label}</span>
                  <span className="block text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Clock className="h-3.5 w-3.5" /> {a.durationMinutes} Minuten
                  </span>
                </button>
              ))}
            </div>
            {addressText && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {addressText}
              </p>
            )}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid gap-5 md:grid-cols-[290px_1fr]">
        {/* Links: worum es geht */}
        <Card className="h-fit">
          <CardContent className="p-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">SL WERBUNG</p>
              <h1 className="text-xl font-semibold leading-tight mt-1">{art.label}</h1>
              {ctx.project.number && (
                <p className="text-sm text-muted-foreground mt-1">Projekt {ctx.project.number}</p>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                <span>{art.durationMinutes} Minuten</span>
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {addressText || "Adresse bitte eintragen"}
                  {ctx.address?.source === "customer" && !addressApplied && (
                    <span className="block text-xs">(Ihre Kundenadresse)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4 shrink-0" />
                <span>Vor Ort mit einem Kollegen von uns</span>
              </div>
            </div>

            {ctx.appointments.length > 1 && (
              <Button
                variant="ghost" size="sm" className="w-full -ml-1 justify-start"
                onClick={() => { setArt(null); setSelectedSlot(null); setSlots([]); }}
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> andere Terminart
              </Button>
            )}

            {!editAddress ? (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setEditAddress(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Adresse ändern
              </Button>
            ) : (
              <div className="space-y-2 pt-1">
                <div>
                  <Label htmlFor="street" className="text-xs">Straße und Nr.</Label>
                  <Input id="street" value={street} onChange={(e) => setStreet(e.target.value)} />
                </div>
                <div className="grid grid-cols-[90px_1fr] gap-2">
                  <div>
                    <Label htmlFor="zip" className="text-xs">PLZ</Label>
                    <Input id="zip" value={zip} onChange={(e) => setZip(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="city" className="text-xs">Ort</Label>
                    <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
                  </div>
                </div>
                <Button
                  size="sm" className="w-full"
                  onClick={() => { setEditAddress(false); setAddressApplied((n) => n + 1); }}
                >
                  Übernehmen
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Mit der Adresse rechnen wir die Anfahrt ein — die freien Zeiten können sich dadurch ändern.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rechts: Tag, Uhrzeit, Bestaetigung */}
        <Card>
          <CardContent className="p-5">
            {!selectedSlot ? (
              <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                <div>
                  <p className="font-medium mb-2 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" /> Tag wählen
                  </p>
                  <Calendar
                    mode="single"
                    weekStartsOn={1}
                    month={month}
                    onMonthChange={setMonth}
                    selected={selectedDay ? DateTime.fromISO(selectedDay, { zone: TZ }).toJSDate() : undefined}
                    onSelect={(d) => {
                      if (!d) return;
                      setSelectedDay(DateTime.fromJSDate(d).toFormat("yyyy-MM-dd"));
                      setSelectedSlot(null);
                    }}
                    disabled={(d) => {
                      const k = DateTime.fromJSDate(d).toFormat("yyyy-MM-dd");
                      return !slotsByDay.has(k);
                    }}
                    modifiers={{ frei: freeDays }}
                    modifiersClassNames={{ frei: "font-semibold text-primary" }}
                  />
                </div>

                <div className="min-w-0">
                  <p className="font-medium mb-2">
                    {selectedDay
                      ? DateTime.fromISO(selectedDay, { zone: TZ }).setLocale("de").toFormat("cccc, d. LLLL")
                      : "Uhrzeit"}
                  </p>
                  {loadingSlots ? (
                    <div className="flex items-center text-sm text-muted-foreground py-6">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> wird geladen…
                    </div>
                  ) : daySlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6">
                      In diesem Monat ist nichts frei. Bitte im nächsten Monat schauen.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[420px] overflow-auto pr-1">
                      {daySlots.map((s) => (
                        <Button
                          key={s.startsAt} variant="outline"
                          onClick={() => { setSelectedSlot(s); setSubmitError(null); }}
                        >
                          {timeLabel(s.startsAt)}
                        </Button>
                      ))}
                    </div>
                  )}
                  {submitError && !selectedSlot && (
                    <p className="text-sm text-destructive mt-3">{submitError}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-lg">
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setSelectedSlot(null)}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> anderen Termin wählen
                </Button>

                <div className="rounded-lg border p-3 text-sm">
                  <Badge variant="secondary" className="mb-2">Ihr Termin</Badge>
                  <p className="font-medium">
                    {DateTime.fromISO(selectedSlot.startsAt, { zone: "utc" }).setZone(TZ).setLocale("de")
                      .toFormat("cccc, d. LLLL yyyy")}
                  </p>
                  <p className="text-muted-foreground">
                    {timeLabel(selectedSlot.startsAt)} – {timeLabel(selectedSlot.endsAt)} Uhr
                    {addressText ? ` · ${addressText}` : ""}
                  </p>
                </div>

                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="email">E-Mail *</Label>
                      <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="phone">Telefon</Label>
                      <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="hinweis">Hinweis für uns (optional)</Label>
                    <Textarea
                      id="hinweis" rows={3} value={hinweis} onChange={(e) => setHinweis(e.target.value)}
                      placeholder="z. B. Zufahrt, Ansprechpartner vor Ort, Leiter nötig"
                    />
                  </div>
                </div>

                {submitError && <p className="text-sm text-destructive">{submitError}</p>}

                <Button className="w-full" disabled={submitting} onClick={submit}>
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> wird gebucht…</> : "Termin bestätigen"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Der Termin gilt sofort. Sie bekommen eine Bestätigung per E-Mail mit Kalendereintrag
                  und einem Link, über den Sie jederzeit absagen können.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">{children}</div>
    </div>
  );
}
