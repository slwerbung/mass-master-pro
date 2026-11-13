// Signatur der Nachfass-Mails: die des zustaendigen Mitarbeiters. „Mitarbeiter“ = das Postfach mit seiner Adresse
// (sl@, jl@ … tragen jeweils die persoenliche Signatur). Reihenfolge: Zustaendige im HERO-Projekt, sonst wer klickt.

export interface SigAccount { address: string; signature_html: string | null }
export interface PickedSignature { html: string; address: string }

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Signatur des ersten Zustaendigen (HERO-Bearbeiter) mit Postfach-Signatur, sonst die des Benutzers; null = keine gefunden. */
export function pickSignature(assignees: string[], userEmail: string | null, accounts: SigAccount[]): PickedSignature | null {
  const by = new Map<string, SigAccount>();
  for (const a of accounts) if (a.signature_html?.trim() && norm(a.address)) by.set(norm(a.address), a);
  for (const e of [...assignees, userEmail ?? ""]) {
    const a = by.get(norm(e));
    if (a) return { html: a.signature_html!.trim(), address: a.address };
  }
  return null;
}
