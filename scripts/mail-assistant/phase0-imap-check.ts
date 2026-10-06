// Phase-0-Technikcheck fuer den Mail-Assistenten, gegen ein ECHTES Postfach.
//
//   IMAP_HOST=imap.ionos.de IMAP_USER=info@slwerbung.de IMAP_PASS='...' \
//   deno run -A --config scripts/mail-assistant/deno.json \
//     scripts/mail-assistant/phase0-imap-check.ts [--write]
//
// Ohne --write wird NICHTS veraendert (nur lesen). Mit --write:
//   * ein Test-Schlagwort wird an die neueste Mail im Posteingang gesetzt und
//     in einer ZWEITEN Verbindung wieder gelesen (bleibt es gespeichert?) und
//     danach wieder entfernt,
//   * ein Test-Entwurf wird in den Entwuerfe-Ordner geschrieben (nicht geloescht —
//     bitte von Hand entfernen).
// Das Skript sendet nie und loescht nie. Das Ergebnis (JSON auf stdout) gehoert
// in docs/mail-assistant/phase0.md.

import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { addKeywords, appendDraft, fetchNew, listFolders, pickSpecial, removeKeywords, withImap } from "../../supabase/functions/_shared/email/imap.ts";

const env = (k: string, d?: string) => Deno.env.get(k) ?? d;
const host = env("IMAP_HOST", "imap.ionos.de")!;
const port = Number(env("IMAP_PORT", "993"));
const user = env("IMAP_USER");
const pass = env("IMAP_PASS");
if (!user || !pass) {
  console.error("IMAP_USER und IMAP_PASS setzen.");
  Deno.exit(2);
}
const secure = env("IMAP_SECURE") ? env("IMAP_SECURE") === "true" : undefined;
const write = Deno.args.includes("--write");
const creds = { host, port, user, pass, secure };
const out: Record<string, unknown> = { runtime: `Deno ${Deno.version.deno}`, host, port, write };

const t0 = performance.now();
const KEYWORD = "KI-Test";

await withImap(creds, async (client) => {
  out.connectMs = Math.round(performance.now() - t0);
  const folders = await listFolders(client);
  out.folders = folders.map((f) => ({ path: f.path, specialUse: f.specialUse }));
  out.sent = pickSpecial(folders, "\\Sent");
  out.drafts = pickSpecial(folders, "\\Drafts");
  out.trash = pickSpecial(folders, "\\Trash");
  out.junk = pickSpecial(folders, "\\Junk");

  const t1 = performance.now();
  const res = await fetchNew(client, "INBOX", { lastUid: null, uidValidity: null, limit: 50, backfill: 50 });
  let parsed = 0, withAttach = 0, failed = 0;
  for (const m of res.messages) {
    try {
      const p = await simpleParser(m.source as any);
      parsed++;
      if (p.attachments?.length) withAttach++;
    } catch { failed++; }
  }
  out.inbox = {
    uidValidity: res.state.uidValidity, exists: res.state.exists,
    fetched: res.messages.length, parsed, parseFailed: failed, withAttachments: withAttach,
    ms: Math.round(performance.now() - t1),
  };

  if (write && res.messages.length) {
    const newest = res.messages[res.messages.length - 1];
    await addKeywords(client, "INBOX", newest.uid, [KEYWORD]);
    out.keywordSet = { uid: newest.uid };
    out.keywordUid = newest.uid;
  }
  if (write && out.drafts) {
    const raw: Uint8Array = await new MailComposer({
      from: user, to: user, subject: "KI-Test Entwurf – Umlaute: äöüß",
      text: "Test des Mail-Assistenten, Phase 0. Kann geloescht werden.",
    }).compile().build();
    out.draftUid = await appendDraft(client, out.drafts as string, raw);
  }
});

if (write && out.keywordUid) {
  // Zweite Verbindung: ist das Schlagwort wirklich dauerhaft gespeichert?
  await withImap(creds, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const m: any = await client.fetchOne(String(out.keywordUid), { flags: true }, { uid: true });
      out.keywordPersisted = [...(m?.flags ?? [])].includes(KEYWORD);
      out.permanentFlags = [...((client.mailbox as any)?.permanentFlags ?? [])];
    } finally { lock.release(); }
    await removeKeywords(client, "INBOX", Number(out.keywordUid), [KEYWORD]);
  });
}

console.log(JSON.stringify(out, null, 2));
