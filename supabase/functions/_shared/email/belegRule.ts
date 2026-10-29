// Was ist ein Beleg fuer Lexware? Rechnungen, Gutschriften, Quittungen, Abrechnungen – NIE Auftragsbestaetigungen,
// Bestell-/Versandbestaetigungen oder Lieferscheine (Vorgabe Okt. 2026: die erzeugen in Lexware falsche Belege).
// Das Modell stuft solche Mails manchmal als Beleg ein; diese Regel entscheidet im Code.

/** Dokumente, die nie an Lexware gehen. „AB 82600491“ = Auftragsbestaetigung. */
const NOT_BELEG = /auftragsbest(ä|ae)tigung|bestellbest(ä|ae)tigung|versandbest(ä|ae)tigung|versandbenachrichtigung|lieferschein|lieferavis|order confirmation|delivery note|packing slip|dispatch note|shipping confirmation|\bAB[\s:-]*\d/i;
/** steht ausdruecklich eine Rechnung/Gutschrift im Betreff, gilt sie trotzdem als Beleg (z. B. „Rechnung und Lieferschein“) */
const IS_BELEG = /rechnung|gutschrift|quittung|beleg|abrechnung|invoice|receipt|credit note|refund|\bRE[\s:-]*\d/i;

export interface BelegMail {
  category: string | null;
  subject: string | null;
  extracted?: { beleg?: { is_booking_document?: boolean } | null } | null;
}

/** Darf diese Mail als Beleg an Lexware (bzw. als „Weiterleitung offen“ vorgemerkt) werden? */
export function isLexwareBeleg(m: BelegMail): boolean {
  const s = String(m.subject ?? "");
  if (NOT_BELEG.test(s) && !IS_BELEG.test(s)) return false;
  if (m.category === "beleg") return true;
  // Andere Kategorie (z. B. Lieferant): nur, wenn das Modell einen Beleg erkennt UND der Betreff ihn ausdruecklich nennt.
  return m.extracted?.beleg?.is_booking_document === true && IS_BELEG.test(s);
}
