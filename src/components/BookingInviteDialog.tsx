// Termineinladung verschicken — aus der Projektuebersicht (allgemeiner Link)
// oder aus einem Projekt (Link mit Projektbezug).
//
// Reihenfolge ist Absicht: erst die TERMINART, dann der Link. Die Terminart
// waehlt der Mitarbeiter, nicht der Kunde — er weiss, worum es geht. Vorher
// stand der Kunde vor einer Auswahl, mit der er nichts anfangen konnte.
//
// Der Link gehoert immer dem angemeldeten Mitarbeiter: wer einlaedt, bekommt
// den Termin. Beide Links kommen fertig vom Server und werden hier nicht
// zusammengebaut — sonst stuende in der Mail etwas anderes als im Kalender.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, Clock, Copy, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { getSession } from "@/lib/session";
import { loadInviteLinks, sendBookingInvite, loadBookingContext, type BookingInviteLinks } from "@/lib/bookingApi";

/** Kurztext zum Terminort — mehr braucht der Mitarbeiter hier nicht. */
const ORT_TEXT: Record<string, string> = {
  buero: "bei uns im Büro",
  telefon: "am Telefon",
  online: "online",
  vor_ort: "beim Kunden",
};

/**
 * Ein paar runde Laengen zum Antippen, innerhalb der erlaubten Grenzen.
 * Tippen geht weiter — das ist nur der schnelle Weg fuer die ueblichen Faelle.
 */
function schnellwahl(min: number, max: number): number[] {
  return [60, 120, 240, 360, 480].filter((m) => m >= min && m <= max);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gesetzt = Einladung mit Projektbezug, sonst der allgemeine Dauerlink. */
  projectId?: string | null;
  projectNumber?: string | null;
}

export function BookingInviteDialog({ open, onOpenChange, projectId, projectNumber }: Props) {
  const [daten, setDaten] = useState<BookingInviteLinks | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laden, setLaden] = useState(false);
  const [art, setArt] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [senden, setSenden] = useState(false);
  // Dauer dieses einen Termins (nur bei Terminarten, die das erlauben).
  const [dauer, setDauer] = useState<number | null>(null);

  const token = getSession()?.authToken;
  const gewaehlt = daten?.appointments.find((a) => a.key === art) ?? null;

  // Links holen, sobald der Dialog aufgeht. Dabei legt der Server bei Bedarf
  // den Buchungsdatensatz des Mitarbeiters an — deshalb nicht vorab laden.
  useEffect(() => {
    if (!open) return;
    setFehler(null);
    setNote("");
    setEmail("");
    setArt(null);
    setDauer(null);
    if (!token) { setFehler("Nicht angemeldet."); return; }
    let abgebrochen = false;
    setLaden(true);
    loadInviteLinks(token, projectId ?? null)
      .then((d) => {
        if (abgebrochen) return;
        setDaten(d);
        // Gibt es nur eine Terminart, ist nichts zu entscheiden.
        if (d.appointments.length === 1) setArt(d.appointments[0].key);
      })
      .catch((e) => { if (!abgebrochen) setFehler((e as Error).message); })
      .finally(() => { if (!abgebrochen) setLaden(false); });
    return () => { abgebrochen = true; };
  }, [open, token, projectId]);

  // Bei Projektbezug die Mailadresse vorschlagen: der Kontext kennt sie aus
  // HERO. Fehlschlag ist egal — dann tippt der Mitarbeiter sie ein.
  useEffect(() => {
    if (!open || !projectId) return;
    let abgebrochen = false;
    loadBookingContext({ projectId })
      .then((ctx) => { if (!abgebrochen && ctx.contact.email) setEmail(ctx.contact.email); })
      .catch(() => { /* kein Vorschlag, kein Problem */ });
    return () => { abgebrochen = true; };
  }, [open, projectId]);

  // Terminart gewechselt: Vorgabedauer uebernehmen, damit im Feld etwas
  // Sinnvolles steht.
  useEffect(() => {
    if (!gewaehlt) { setDauer(null); return; }
    setDauer(gewaehlt.durationChoosable ? gewaehlt.durationMinutes : null);
    // Absicht: nur beim Wechsel der Terminart, nicht bei jedem Nachladen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art]);

  /**
   * Neue Links holen, wenn die Dauer sich geaendert hat.
   *
   * Der Link kommt IMMER vom Server — hier wird nichts zusammengesetzt, sonst
   * stuende in der Mail etwas anderes als im Kalender. Deshalb ein kurzes
   * Nachladen statt eines selbstgebauten `&d=`.
   */
  useEffect(() => {
    if (!open || !token || !gewaehlt?.durationChoosable || !dauer) return;
    if (dauer === gewaehlt.linkDuration) return;
    const timer = setTimeout(() => {
      loadInviteLinks(token, projectId ?? null, { ruleSet: gewaehlt.key, duration: dauer })
        .then((d) => setDaten(d))
        .catch(() => { /* der alte Link bleibt stehen */ });
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dauer, art, open, token, projectId]);

  async function kopieren(text: string, was: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${was} kopiert`);
    } catch {
      toast.error("Kopieren hat nicht geklappt – bitte markieren");
    }
  }

  async function abschicken() {
    if (!token || !gewaehlt) return;
    if (!email.trim()) { toast.error("Bitte eine E-Mail-Adresse angeben."); return; }
    setSenden(true);
    try {
      await sendBookingInvite({
        token,
        email: email.trim(),
        ruleSet: gewaehlt.key,
        duration: gewaehlt.durationChoosable ? dauer : null,
        projectId: projectId ?? null,
        projectNumber: projectNumber ?? null,
        note: note.trim() || undefined,
      });
      toast.success(`Einladung an ${email.trim()} verschickt`);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSenden(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Termineinladung
          </DialogTitle>
          <DialogDescription>
            {projectId
              ? `Du wählst die Terminart, der Kunde nur die Zeit. Der Termin gehört zu Projekt ${projectNumber || "diesem Projekt"} und wird dir zugeordnet.`
              : "Du wählst die Terminart, der Kunde nur die Zeit. Der Termin wird dir zugeordnet, ohne Projektbezug."}
          </DialogDescription>
        </DialogHeader>

        {laden ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> wird vorbereitet…
          </div>
        ) : fehler ? (
          <p className="text-sm text-destructive py-4">{fehler}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Terminart</Label>
              <div className="grid gap-2">
                {(daten?.appointments ?? []).map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setArt(a.key)}
                    className={`text-left rounded-lg border p-2.5 transition-colors ${
                      a.key === art ? "border-primary bg-accent" : "hover:bg-muted/60"
                    }`}
                  >
                    <span className="font-medium text-sm">{a.label}</span>
                    <span className="block text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Clock className="h-3.5 w-3.5" />
                      {a.durationChoosable ? "Dauer wählbar" : `${a.durationMinutes} Minuten`}
                      {a.locationMode && a.locationMode !== "vor_ort" && (
                        <span>· {ORT_TEXT[a.locationMode]}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Dauer dieses einen Termins. Nur bei Terminarten, bei denen das
                im Adminmenue erlaubt ist („Montage vor Ort": 3 h oder 8 h). */}
            {gewaehlt?.durationChoosable && (
              <div className="space-y-1.5">
                <Label className="text-xs">Wie lange dauert dieser Termin?</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {schnellwahl(gewaehlt.durationMin ?? 15, gewaehlt.durationMax ?? 720).map((m) => (
                    <Button
                      key={m} type="button" size="sm"
                      variant={dauer === m ? "default" : "outline"}
                      onClick={() => setDauer(m)}
                    >
                      {m % 60 === 0 ? `${m / 60} h` : `${m} Min.`}
                    </Button>
                  ))}
                  <Input
                    type="number" className="w-24"
                    min={gewaehlt.durationMin} max={gewaehlt.durationMax} step={15}
                    value={dauer ?? ""}
                    onChange={(e) => setDauer(e.target.value === "" ? null : Number(e.target.value))}
                  />
                  <span className="text-xs text-muted-foreground">Minuten</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Erlaubt sind {gewaehlt.durationMin} bis {gewaehlt.durationMax} Minuten.
                  Der Kunde sieht dann nur Zeiten, in die diese Länge passt.
                </p>
              </div>
            )}

            {/* Der Link entsteht erst mit der Terminart — sonst wüsste er nicht,
                worauf der Kunde landen soll. */}
            {gewaehlt ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Link für „{gewaehlt.label}“
                    {gewaehlt.durationChoosable && ` · ${gewaehlt.linkDuration} Minuten`}
                  </Label>
                  <div className="flex gap-2">
                    <Input readOnly value={gewaehlt.link} className="text-xs"
                      onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" variant="outline" size="icon" title="Link kopieren"
                      onClick={() => kopieren(gewaehlt.link, "Link")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Fuer HERO-Mailvorlagen: Mitarbeiter und Projekt als
                    Platzhalter, die HERO beim Versand fuellt. */}
                <div className="space-y-1">
                  <Label className="text-xs">Für eine HERO-Mailvorlage</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={gewaehlt.vorlage} className="text-xs font-mono"
                      onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" variant="outline" size="icon" title="Vorlagenlink kopieren"
                      onClick={() => kopieren(gewaehlt.vorlage, "Vorlagenlink")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Mitarbeiter und Projekt füllt HERO beim Versand aus. Einmal pro Terminart in
                    die passende Vorlage einsetzen – danach braucht es diesen Dialog dafür nicht mehr.
                    Beim Einsetzen bitte prüfen, dass der Link bis zum letzten Zeichen verlinkt ist.
                    {gewaehlt.durationChoosable && " Die Dauer steht fest im Link: eine Vorlage je Länge."}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Terminart wählen – danach steht hier der Link zum Kopieren.
              </p>
            )}

            <div className="space-y-1">
              <Label className="text-xs">E-Mail des Kunden</Label>
              <Input
                type="email" value={email} placeholder="kunde@beispiel.de"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Persönliche Zeile (optional)</Label>
              <Textarea
                rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="z.B. wie besprochen – melden Sie sich gern, wenn keine Zeit passt."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={abschicken} disabled={laden || senden || !!fehler || !gewaehlt || !email.trim()}>
            {senden ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}
            Einladung senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BookingInviteDialog;
