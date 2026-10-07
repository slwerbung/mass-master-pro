// Beleg an die Lexware-Belegadresse weiterleiten.
//
// Zwei Wege:
//   * „send":  echter Versand (siehe lexwareSend.ts – einzige Ausnahme vom Grundsatz „Kein Versand“),
//              nur an die hinterlegte Belegadresse. Scheitert er, entsteht stattdessen ein ENTWURF.
//   * „draft": fertiger Weiterleitungs-Entwurf im Ordner „Entwuerfe“; gesendet wird in Thunderbird.
// Jede Mail wird hoechstens EINMAL weitergeleitet (`forwarded_at`).

export interface ForwardMsg {
  id: string;
  from_addr: string;
  from_name: string;
  subject: string;
  sent_at: string | null;
  body_text: string | null;
  forwarded_at?: string | null;
}

export interface ForwardFile { filename: string; mime: string; bytes: Uint8Array }

export interface BelegFileRow { filename: string; mime: string; role: string | null }

/** Welche Anhaenge gehoeren zum Beleg? Dateien (PDF, Bild, XML/ZUGFeRD); gibt es welche mit Rolle „Rechnung“, nur diese. */
export function isBelegFile(r: BelegFileRow): boolean {
  return /^(application\/pdf|image\/|application\/xml|text\/xml)/i.test(r.mime) || /\.(pdf|xml|jpe?g|png|tiff?)$/i.test(r.filename);
}
export function pickBelegFiles<T extends BelegFileRow>(rows: T[]): T[] {
  const files = rows.filter(isBelegFile);
  const invoices = files.filter((r) => r.role === "rechnung");
  return invoices.length ? invoices : files;
}

export interface ForwardDeps {
  /** Hinterlegte Lexware-Belegadresse. */
  address: string;
  loadMessage(id: string): Promise<ForwardMsg | null>;
  loadFiles(messageId: string): Promise<ForwardFile[]>;
  buildMime(h: { to: string; subject: string; text: string; files: ForwardFile[] }): Promise<Uint8Array>;
  /** In den Entwuerfe-Ordner legen. */
  append(raw: Uint8Array): Promise<number | null>;
  /** Echter Versand (lexwareSend.ts). Fehlt er, bleibt es beim Entwurf. */
  send?(raw: Uint8Array, to: string): Promise<void>;
  /** Merkt sich Weiterleitung/Entwurf an der Mail (forwarded_at, Stand). */
  markForwarded(id: string, how: "gesendet" | "entwurf"): Promise<void>;
}

export class ForwardError extends Error {}

export const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export function forwardText(m: ForwardMsg, sent: boolean): string {
  return [
    sent ? "Beleg zur Verbuchung (automatisch vom Mail-Assistenten weitergeleitet)." : "Beleg zur Verbuchung (vom Mail-Assistenten als Entwurf vorbereitet).",
    "",
    `Ursprünglicher Absender: ${m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr}`,
    `Betreff: ${m.subject || "(ohne Betreff)"}`,
    `Datum: ${m.sent_at ?? "unbekannt"}`,
    "",
    "Die Belege hängen an dieser Mail an.",
  ].join("\n");
}

export interface ForwardResult { files: number; how: "gesendet" | "entwurf"; uid: number | null; fallbackReason?: string }

export async function forwardBeleg(messageId: string, deps: ForwardDeps, mode: "send" | "draft"): Promise<ForwardResult> {
  const to = deps.address.trim();
  if (!EMAIL_RE.test(to)) throw new ForwardError("Die Lexware-Belegadresse fehlt oder ist ungültig (Einstellungen → Firma & HERO).");
  const m = await deps.loadMessage(messageId);
  if (!m) throw new ForwardError("Mail nicht gefunden.");
  if (m.forwarded_at) throw new ForwardError("Diese Mail wurde schon weitergeleitet.");
  const files = await deps.loadFiles(messageId);
  if (!files.length) throw new ForwardError("Die Mail hat keinen gespeicherten Beleg-Anhang – es gibt nichts weiterzuleiten.");
  const subject = `Fwd: ${m.subject || "Beleg"}`.slice(0, 300);

  let fallbackReason: string | undefined;
  if (mode === "send" && deps.send) {
    try {
      const raw = await deps.buildMime({ to, subject, text: forwardText(m, true), files });
      await deps.send(raw, to);
      await deps.markForwarded(messageId, "gesendet");
      return { files: files.length, how: "gesendet", uid: null };
    } catch (e) {
      // Nichts geht verloren: der Beleg landet als Entwurf zum Selbstsenden im Postfach.
      fallbackReason = String((e as Error)?.message || e).slice(0, 160);
    }
  } else if (mode === "send") {
    fallbackReason = "Versand nicht eingerichtet";
  }

  const raw = await deps.buildMime({ to, subject, text: forwardText(m, false), files });
  const uid = await deps.append(raw);
  await deps.markForwarded(messageId, "entwurf");
  return { files: files.length, how: "entwurf", uid, ...(fallbackReason ? { fallbackReason } : {}) };
}
