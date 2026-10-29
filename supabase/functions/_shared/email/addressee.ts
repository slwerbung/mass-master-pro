// Wer bekommt eine Mail zur Entscheidung? Ist sie ausdruecklich an einen Mitarbeiter gerichtet (Anrede „Hallo Jonas“,
// „z. Hd. Herrn Lang“ oder seine eigene Adresse im An-Feld), nur er. Sonst – allgemein oder nicht eindeutig – alle,
// die das Postfach sehen. Lieber einmal zu viel vorlegen als eine Mail verlieren: im Zweifel immer alle.

export interface AddresseeUser {
  id: string;
  /** Anzeigename, z. B. „Jonas Lang“ */
  name: string;
  /** Adressen, unter denen er persoenlich angeschrieben wird (klein geschrieben) */
  emails: string[];
}

export interface AddresseeMail { to_addrs?: string[] | null; subject?: string | null; body_text?: string | null }

const L = "\\p{Lu}[\\p{L}'-]+";
/** Anrede am Zeilenanfang der ersten Zeilen */
const GREETING = new RegExp(
  `^\\s*(?:hallo|hi|hey|moin|servus|gr(?:ü|ue)(?:ß|ss) (?:dich|gott)|guten (?:morgen|tag|abend)|liebe[rs]?|sehr geehrte[rs]?)[,!]?\\s+(?:herr(?:n)?\\s+|frau\\s+)?(${L})(?:\\s+(${L}))?`,
  "imu",
);
/** „z. Hd. Herrn Lang“, „zu Händen von Jonas“, „Attn: …“ – auch im Betreff */
const ATTN = new RegExp(`(?:z\\.?\\s?hd\\.?|zu h(?:ä|ae)nden(?: von)?|attn\\.?|attention)\\s*:?\\s*(?:herr(?:n)?\\s+|frau\\s+)?(${L})(?:\\s+(${L}))?`, "iu");

const norm = (s: string) => s.toLowerCase().normalize("NFC");
const parts = (name: string) => norm(name).split(/[\s-]+/).filter((w) => w.length >= 2);

/** Mitarbeiter zu angesprochenen Namen: alle genannten Woerter muessen zu seinem Namen passen. Nur eindeutige Treffer. */
function byNames(words: string[], users: AddresseeUser[]): AddresseeUser | null {
  const ws = words.map(norm).filter((w) => w.length >= 2);
  if (!ws.length) return null;
  const hits = users.filter((u) => {
    const p = parts(u.name);
    return p.length > 0 && ws.every((w) => p.includes(w));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Mitarbeiter, an den die Mail ausdruecklich gerichtet ist – oder null (= alle mit Zugriff auf das Postfach). */
export function addresseeOf(m: AddresseeMail, users: AddresseeUser[]): AddresseeUser | null {
  if (users.length < 2) return null; // einer allein bekommt sie ohnehin
  // 1. Eigene Adresse im An-Feld (nicht CC): genau einer
  const to = (m.to_addrs ?? []).map((a) => norm(a));
  const byMail = users.filter((u) => u.emails.some((e) => to.includes(norm(e))));
  if (byMail.length === 1) return byMail[0];
  if (byMail.length > 1) return null;
  // 2. Anrede in den ersten Zeilen oder „z. Hd.“
  const head = String(m.body_text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).slice(0, 4).join("\n");
  for (const re of [GREETING, ATTN]) {
    for (const src of [head, re === ATTN ? String(m.subject ?? "") : ""]) {
      const g = src ? src.match(re) : null;
      if (!g) continue;
      const one = byNames([g[1], g[2]].filter(Boolean) as string[], users) ?? (g[2] ? byNames([g[1]], users) : null);
      if (one) return one;
    }
  }
  return null;
}
