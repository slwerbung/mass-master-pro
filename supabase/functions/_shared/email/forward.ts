// Beleg an die Lexoffice-Belegadresse „weiterleiten".
//
// WICHTIG – Kein Versand: der Assistent sendet nie. „Weiterleiten" heisst hier: ein fertiger
// Weiterleitungs-ENTWURF (An: Lexoffice-Belegadresse, mit den Anhaengen der Mail) liegt im Ordner
// „Entwuerfe"; gesendet wird in Thunderbird von einem Menschen.

export interface ForwardMsg {
  id: string;
  from_addr: string;
  from_name: string;
  subject: string;
  sent_at: string | null;
  body_text: string | null;
}

export interface ForwardFile { filename: string; mime: string; bytes: Uint8Array }

export interface ForwardDeps {
  address: string;
  loadMessage(id: string): Promise<ForwardMsg | null>;
  loadFiles(messageId: string): Promise<ForwardFile[]>;
  buildMime(h: { to: string; subject: string; text: string; files: ForwardFile[] }): Promise<Uint8Array>;
  /** In den Entwuerfe-Ordner legen. */
  append(raw: Uint8Array): Promise<number | null>;
}

export class ForwardError extends Error {}

export const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export function forwardText(m: ForwardMsg): string {
  return [
    "Beleg zur Verbuchung (vom Mail-Assistenten als Entwurf vorbereitet).",
    "",
    `Ursprünglicher Absender: ${m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr}`,
    `Betreff: ${m.subject || "(ohne Betreff)"}`,
    `Datum: ${m.sent_at ?? "unbekannt"}`,
    "",
    "Die Belege hängen an dieser Mail an.",
  ].join("\n");
}

export async function forwardBelegDraft(messageId: string, deps: ForwardDeps): Promise<{ files: number; uid: number | null }> {
  if (!EMAIL_RE.test(deps.address.trim())) throw new ForwardError("Die Lexoffice-Belegadresse fehlt oder ist ungültig (Einstellungen → Firma & HERO).");
  const m = await deps.loadMessage(messageId);
  if (!m) throw new ForwardError("Mail nicht gefunden.");
  const files = await deps.loadFiles(messageId);
  if (!files.length) throw new ForwardError("Die Mail hat keinen gespeicherten Anhang – es gibt nichts weiterzuleiten.");
  const raw = await deps.buildMime({ to: deps.address.trim(), subject: `Fwd: ${m.subject || "Beleg"}`.slice(0, 300), text: forwardText(m), files });
  const uid = await deps.append(raw);
  return { files: files.length, uid };
}
