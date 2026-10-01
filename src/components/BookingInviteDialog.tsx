// Termineinladung verschicken — aus der Projektuebersicht (allgemeiner Link)
// oder aus einem Projekt (Link mit Projektbezug).
//
// Der Link gehoert immer dem angemeldeten Mitarbeiter: wer einlaedt, bekommt
// den Termin. Der Link kommt deshalb vom Server und wird hier nicht
// zusammengebaut — sonst stuende in der Mail etwas anderes als im Kalender.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, Copy, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { getSession } from "@/lib/session";
import { loadInviteLinks, sendBookingInvite, loadBookingContext, type BookingInviteLinks } from "@/lib/bookingApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gesetzt = Einladung mit Projektbezug, sonst der allgemeine Dauerlink. */
  projectId?: string | null;
  projectNumber?: string | null;
}

export function BookingInviteDialog({ open, onOpenChange, projectId, projectNumber }: Props) {
  const [links, setLinks] = useState<BookingInviteLinks | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laden, setLaden] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [senden, setSenden] = useState(false);

  const token = getSession()?.authToken;
  const link = links ? (projectId ? links.linkProjekt ?? links.linkAllgemein : links.linkAllgemein) : "";

  // Link holen, sobald der Dialog aufgeht. Dabei legt der Server bei Bedarf
  // den Buchungsdatensatz des Mitarbeiters an — deshalb nicht vorab laden.
  useEffect(() => {
    if (!open) return;
    setFehler(null);
    setNote("");
    setEmail("");
    if (!token) { setFehler("Nicht angemeldet."); return; }
    let abgebrochen = false;
    setLaden(true);
    loadInviteLinks(token, projectId ?? null)
      .then((l) => { if (!abgebrochen) setLinks(l); })
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

  async function kopieren() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link kopiert");
    } catch {
      toast.error("Kopieren hat nicht geklappt – Link bitte markieren");
    }
  }

  async function abschicken() {
    if (!token) return;
    if (!email.trim()) { toast.error("Bitte eine E-Mail-Adresse angeben."); return; }
    setSenden(true);
    try {
      await sendBookingInvite({
        token,
        email: email.trim(),
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
              ? `Der Kunde wählt selbst eine freie Zeit. Der Termin gehört zu Projekt ${projectNumber || "diesem Projekt"} und wird dir zugeordnet.`
              : "Der Kunde wählt selbst eine freie Zeit. Der Termin wird dir zugeordnet, ohne Projektbezug."}
          </DialogDescription>
        </DialogHeader>

        {laden ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Link wird vorbereitet…
          </div>
        ) : fehler ? (
          <p className="text-sm text-destructive py-4">{fehler}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Dein Terminlink</Label>
              <div className="flex gap-2">
                <Input readOnly value={link} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" size="icon" onClick={kopieren} title="Link kopieren">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

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
          <Button onClick={abschicken} disabled={laden || senden || !!fehler || !email.trim()}>
            {senden ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}
            Einladung senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BookingInviteDialog;
