// Oeffentliche Buchungsseite. Drei Linkformen, eine Seite:
//   /termin/m/:slug            Dauerlink eines Mitarbeiters, ohne Projekt.
//                              Der Kunde traegt Adresse und Kontakt selbst ein.
//   /termin/:projectId?m=slug  Mit Projekt: Adresse und Kontakt kommen aus HERO
//                              und sind editierbar.
//   /termin/m/<name>/<nr>/<art>  Dieselbe Sache fuer HERO-Mailvorlagen, alles
//                              im PFAD. Grund siehe unten. Die Route ist ein
//                              Sternchen, die Segmente erkennt `pfadTeile`.
// In allen Faellen gehoert der Termin dem Mitarbeiter aus dem Link — wer
// einlaedt, bekommt den Termin. Auch die Terminart steht im Link: die waehlt
// der Mitarbeiter beim Einladen, nicht der Kunde. Ein alter Link ohne
// `m`/`art` funktioniert weiter und laesst dann waehlen.
//
// Warum die Vorlagenform ohne Fragezeichen auskommt: HERO ersetzt Platzhalter
// auch innerhalb eines Links, aber der Mailvorlagen-Editor hat den Link hinter
// `&p={{ProjectMatch.display_id}}` abgeschnitten (im Serverlog kam er ohne `p`
// an, und die Adresse blieb leer). Im Pfad ging derselbe Platzhalter durch.
// Deshalb: Platzhalter nur noch in Pfadsegmenten, und die Terminart als
// festes Segment am Ende — so steht am Linkende keine Klammer.
//
// Aufmachung an Calendly angelehnt (so gewuenscht): links steht, worum es geht,
// rechts waehlt man Tag und Uhrzeit, danach die Bestaetigung.
//
// Gerechnet wird nichts hier: welche Zeiten frei sind, entscheidet der Server,
// und beim Buchen rechnet er den Tag noch einmal neu. Das Frontend darf sich
// also irren, ohne dass daraus ein doppelt vergebener Termin wird.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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

/** „90 Minuten", „4 Stunden", „1,5 Stunden" — wie man es liest. */
function dauerText(minuten: number): string {
  const m = Math.max(0, Math.round(minuten));
  if (m < 60) return `${m} Minuten`;
  const rest = m % 60;
  if (rest !== 0 && rest !== 30) return `${Math.floor(m / 60)} Std. ${rest} Min.`;
  const std = m / 60;
  const text = Number.isInteger(std) ? String(std) : std.toFixed(1).replace(".", ",");
  return `${text} ${std === 1 ? "Stunde" : "Stunden"}`;
}

/** Wo der Termin stattfindet — Satz fuer die linke Spalte. */
function ortText(art: AppointmentType, office?: string | null): string {
  switch (art.locationMode) {
    case "buero": return office ? `Bei uns im Büro, ${office}` : "Bei uns im Büro";
    case "telefon": return "Telefontermin – wir rufen Sie an";
    case "online": return "Onlinetermin – den Link bekommen Sie per E-Mail";
    default: return "";
  }
}

const dayKey = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(TZ).toFormat("yyyy-MM-dd");
const timeLabel = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(TZ).toFormat("HH:mm");

/**
 * Einen Linkbestandteil nur nehmen, wenn er wirklich gefuellt ist.
 *
 * Ersetzt HERO einen Platzhalter nicht (Vorlage falsch geschrieben, Projekt
 * ohne Nummer), steht die Klammer selbst im Link. Die darf nicht als
 * Projektnummer oder Mitarbeiter durchgehen: der Server wuerde mit "Projekt
 * nicht gefunden" abweisen und der Kunde koennte gar nichts buchen. Lieber
 * ohne diesen Bestandteil weiter — Adresse und Terminart traegt er dann selbst
 * ein.
 */
const echt = (v: string | null | undefined): string => {
  const wert = String(v ?? "").trim();
  if (!wert || /[{}]/.test(wert)) return "";
  // Unersetzter Platzhalter ohne Klammern, z.B. "ProjectMatch.display_id".
  if (/^[A-Za-z]+\.[A-Za-z_]+$/.test(wert)) return "";
  return wert;
};

/**
 * Die Segmente hinter `/termin/m/` auseinandernehmen.
 *
 * Erstes Segment ist immer der Mitarbeiter. Was danach kommt, wird am Inhalt
 * erkannt statt an der Position: eine reine Zahl (oder „WER-1744") ist die
 * Projektnummer, alles andere die Terminart. Grund: diese Links stehen in
 * HERO-Mailvorlagen, und was ein Mailprogramm oder ein Vorlagen-Editor damit
 * macht, ist nicht vorhersehbar. Ein Segment zu viel oder eines in anderer
 * Reihenfolge darf nicht im 404 enden — eine falsch geratene Terminart fällt
 * ohnehin durch, weil sie gegen die buchbaren Arten geprüft wird.
 */
function pfadTeile(rest: string): { slug: string; nr: string; art: string; dauer: number | null } {
  const teile = rest.split("/").map(echt).filter(Boolean);
  const slug = teile.shift() || "";
  let nr = "";
  let art = "";
  let dauer: number | null = null;
  for (const t of teile) {
    // Dauer zuerst pruefen: `d240` traegt das `d` genau deshalb, damit es nicht
    // mit einer Projektnummer verwechselt wird.
    const d = /^[dD](\d{1,4})$/.exec(t);
    if (d && dauer == null) { dauer = Number(d[1]) || null; continue; }
    if (!nr && /^[A-Za-z]{0,5}-?\d+$/.test(t)) nr = t;
    else if (!art) art = t;
  }
  return { slug, nr, art, dauer };
}

export default function BookingPage() {
  // Zwei Routen auf derselben Seite: /termin/:projectId und /termin/m/*.
  // Hinter dem Sternchen stehen Mitarbeiter, Projektnummer und Terminart
  // (Vorlagenform, alles im Pfad) — in beliebiger Zahl.
  const { projectId = "", "*": rest = "" } = useParams();
  const [query] = useSearchParams();
  const pfad = useMemo(() => pfadTeile(rest), [rest]);
  // Der Mitarbeiter steckt entweder im Pfad (Dauerlink) oder in `?m=`.
  const staffSlug = pfad.slug || query.get("m") || "";
  // Die Terminart kommt aus der Einladung. Steht sie im Link, bekommt der
  // Kunde keine Auswahl zu sehen.
  const artAusLink = pfad.art || echt(query.get("art"));
  // Dauer dieses Termins: aus dem Pfad (`/d240`, Vorlagenform) oder `?d=240`.
  // Was davon gilt, entscheidet der Server — hier wird nur gelesen.
  const dauerAusLink = pfad.dauer ?? (Number(echt(query.get("d"))) || null);
  // Projekt: unsere UUID im Pfad (Links aus der App), die HERO-Nummer als
  // Pfadsegment (Mailvorlage) oder als `?p=` (aeltere Vorlagen).
  const projektNr = pfad.nr || echt(query.get("p"));
  const heroId = echt(query.get("hp"));
  const ziel = useMemo(
    () => ({
      projectId: projectId || null,
      projectNr: projektNr || null,
      heroId: heroId || null,
      staffSlug: staffSlug || null,
    }),
    [projectId, projektNr, heroId, staffSlug],
  );

  const [ctx, setCtx] = useState<BookingContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Terminart: bei genau einer wird sie sofort gesetzt, bei mehreren waehlt
  // der Kunde zuerst (wie bei Calendly die Event-Typen).
  const [art, setArt] = useState<AppointmentType | null>(null);

  const [month, setMonth] = useState<Date>(new Date());
  const [slots, setSlots] = useState<Slot[]>([]);
  // Die Dauer, mit der der Server gerechnet hat. Angezeigt wird diese, nicht
  // die Vorgabe der Terminart und nicht die Zahl aus dem Link.
  const [dauerMinuten, setDauerMinuten] = useState<number | null>(null);
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
  const [done, setDone] = useState<{
    startsAt: string; endsAt: string;
    meetingUrl?: string | null; treffpunkt?: string | null;
  } | null>(null);

  // ── Kontext laden ──
  useEffect(() => {
    let alive = true;
    loadBookingContext(ziel)
      .then((c) => {
        if (!alive) return;
        setCtx(c);
        // Terminart aus dem Link, sonst: bei genau einer Art direkt diese.
        const ausLink = artAusLink ? c.appointments.find((a) => a.key === artAusLink) : null;
        if (ausLink) setArt(ausLink);
        else if (c.appointments.length === 1) setArt(c.appointments[0]);
        setStreet(c.address?.street || "");
        setZip(c.address?.zipcode || "");
        setCity(c.address?.city || "");
        setName(c.contact.name || c.project?.customerName || "");
        setEmail(c.contact.email || "");
        setPhone(c.contact.phone || "");
        // Aufklappen nur, wenn die Adresse ueberhaupt gebraucht wird. Welche
        // Terminart gilt, steht eine Zeile weiter oben erst fest, deshalb hier
        // gegen die gewaehlte Art pruefen.
        const gewaehlteArt = ausLink ?? (c.appointments.length === 1 ? c.appointments[0] : null);
        const mitAdresse = !gewaehlteArt?.locationMode || gewaehlteArt.locationMode === "vor_ort";
        if (!c.address && mitAdresse) setEditAddress(true);
      })
      .catch((e) => alive && setLoadError(e.message || "Die Buchungsseite konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [ziel, artAusLink]);

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
      const res = await loadAvailability(ziel, art.key, range.from, range.to,
        editAddress || addressApplied ? { street, zip, city } : undefined,
        dauerAusLink);
      setSlots(res.slots || []);
      if (res.durationMinutes) setDauerMinuten(res.durationMinutes);
    } catch (e) {
      setSlots([]);
      setSubmitError((e as Error).message);
    } finally {
      setLoadingSlots(false);
    }
    // street/zip/city bewusst NICHT in den Abhaengigkeiten: es soll erst beim
    // Uebernehmen neu gerechnet werden, nicht bei jedem Tastendruck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, art, ziel, range.from, range.to, addressApplied, dauerAusLink]);

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
  // Nach einer Adresse wird nur gefragt, wenn wir auch hinfahren. Bei Buero-,
  // Telefon- und Onlineterminen waere das eine Frage ohne Zweck.
  const brauchtAdresse = !art?.locationMode || art.locationMode === "vor_ort";
  const telefonPflicht = art?.locationMode === "telefon";

  async function submit() {
    if (!selectedSlot || !ctx || !art) return;
    setSubmitError(null);
    if (!name.trim() || !email.trim()) {
      setSubmitError("Bitte Name und E-Mail angeben.");
      return;
    }
    // Ohne Rufnummer weiss niemand, wen er anrufen soll. Der Server lehnt das
    // ebenfalls ab — hier nur, damit der Kunde es gleich sieht.
    if (telefonPflicht && !phone.trim()) {
      setSubmitError("Für einen Telefontermin brauchen wir Ihre Rufnummer.");
      return;
    }
    const staffId = selectedSlot.assignedStaffId || selectedSlot.staffIds?.[0];
    if (!staffId) {
      setSubmitError("Zu diesem Termin fehlt die Zuordnung. Bitte einen anderen wählen.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createBooking({
        project: ziel.projectId,
        projectNr: ziel.projectNr,
        heroProject: ziel.heroId,
        staff: ziel.staffSlug,
        ruleSet: art.key,
        d: dauerAusLink,
        // Nur der Start wird gemeldet: das Ende rechnet der Server aus der
        // Dauer. Was hier stuende, wuerde ohnehin nicht uebernommen.
        slot: { startsAt: selectedSlot.startsAt },
        staffId,
        contact: { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined },
        addressOverride: brauchtAdresse && (addressApplied || editAddress) ? { street, zip, city } : null,
        hinweis: hinweis.trim() || undefined,
      });
      // Zeiten und Treffpunkt aus der Antwort, nicht aus dem gewaehlten Slot —
      // die Wahrheit steht in der Buchung.
      setDone({
        startsAt: res.booking.startsAt,
        endsAt: res.booking.endsAt,
        meetingUrl: res.booking.meetingUrl ?? null,
        treffpunkt: res.booking.treffpunkt ?? null,
      });
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
          {(done.treffpunkt || addressText) && (
            <p className="text-sm text-muted-foreground">{done.treffpunkt || addressText}</p>
          )}
          {/* Onlinetermin: der Link ist das Wichtigste auf dieser Seite. Er
              kommt zusaetzlich per Mail. */}
          {done.meetingUrl && (
            <p className="text-sm">
              <a href={done.meetingUrl} target="_blank" rel="noreferrer"
                className="inline-block rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
                Zum Videotermin
              </a>
              <span className="block text-xs text-muted-foreground mt-2 break-all">{done.meetingUrl}</span>
            </p>
          )}
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
              {(ctx.project?.number || ctx.staff) && (
                <p className="text-sm text-muted-foreground mt-1">
                  {[
                    ctx.project?.number ? `Projekt ${ctx.project.number}` : "",
                    ctx.staff ? `mit ${ctx.staff.name}` : "",
                  ].filter(Boolean).join(" · ")}
                </p>
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
                    <Clock className="h-3.5 w-3.5" />
                    {dauerText(a.key === artAusLink && dauerAusLink ? dauerAusLink : a.durationMinutes)}
                    {ortText(a, ctx.office) && <span>· {ortText(a, ctx.office)}</span>}
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
              {(ctx.project?.number || ctx.staff) && (
                <p className="text-sm text-muted-foreground mt-1">
                  {[
                    ctx.project?.number ? `Projekt ${ctx.project.number}` : "",
                    ctx.staff ? `mit ${ctx.staff.name}` : "",
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                {/* Die Dauer, mit der der Server gerechnet hat. Solange die
                    Zeiten noch laden, die Vorgabe der Terminart. */}
                <span>{dauerText(dauerMinuten ?? art.durationMinutes)}</span>
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {brauchtAdresse
                    ? (
                      <>
                        {addressText || "Adresse bitte eintragen"}
                        {ctx.address?.source === "customer" && !addressApplied && (
                          <span className="block text-xs">(Ihre Kundenadresse)</span>
                        )}
                      </>
                    )
                    : ortText(art, ctx.office)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4 shrink-0" />
                <span>
                  {art.locationMode === "telefon" ? "Am Telefon mit einem Kollegen von uns"
                    : art.locationMode === "online" ? "Per Video mit einem Kollegen von uns"
                    : "Mit einem Kollegen von uns"}
                </span>
              </div>
            </div>

            {/* Der Link nannte ein Projekt, das es nicht (mehr) gibt. Buchen
                geht weiter, aber ohne Vorbelegung — und das soll man sehen,
                sonst wundert sich der Kunde ueber leere Felder. */}
            {ctx.projectMissing && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/60 rounded-md p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Zu diesem Link konnten wir kein Projekt finden. Buchen können Sie trotzdem –
                  bitte tragen Sie Adresse und Kontaktdaten selbst ein.
                </span>
              </p>
            )}

            {/* Nur wer selbst gewaehlt hat, darf zurueck. Steht die Terminart
                im Einladungslink, ist sie vorgegeben. */}
            {!artAusLink && ctx.appointments.length > 1 && (
              <Button
                variant="ghost" size="sm" className="w-full -ml-1 justify-start"
                onClick={() => { setArt(null); setSelectedSlot(null); setSlots([]); }}
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> andere Terminart
              </Button>
            )}

            {/* Adressblock nur, wenn wir hinfahren. Bei Buero-, Telefon- und
                Onlineterminen gibt es keine Anfahrt und damit nichts zu
                aendern — ein Adressfeld waere dort nur Verwirrung. */}
            {!brauchtAdresse ? null : !editAddress ? (
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
                    // Ein leerer Monat ist normal. Ein Monat ohne EINEN einzigen
                    // Slot kann aber auch heissen, dass fuer diese Terminart
                    // niemand eingeteilt ist — dann hilft Vorwaertsklicken nicht.
                    <div className="text-sm text-muted-foreground py-6 space-y-2">
                      <p>In diesem Monat ist nichts frei. Bitte im nächsten Monat schauen.</p>
                      {slots.length === 0 && (
                        <p>
                          {!artAusLink && ctx.appointments.length > 1
                            ? "Falls hier dauerhaft nichts frei ist: oben eine andere Terminart wählen oder einfach auf unsere E-Mail antworten."
                            : "Falls hier dauerhaft nichts frei ist: einfach auf unsere E-Mail antworten, wir finden gemeinsam einen Termin."}
                        </p>
                      )}
                    </div>
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
                      <Label htmlFor="phone">Telefon{telefonPflicht ? " *" : ""}</Label>
                      <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                      {telefonPflicht && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Unter dieser Nummer rufen wir Sie zum Termin an.
                        </p>
                      )}
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
