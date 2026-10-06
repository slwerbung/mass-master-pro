// Deno-Test (nicht vitest, wegen npm:-Importen): deno test --config supabase/functions/email-draft/deno.json supabase/functions/_shared/email/draftMime.deno_test.ts
import { assertEquals, assert } from "jsr:@std/assert@1";
import { simpleParser } from "mailparser";
import { buildDraftMime, newMessageId } from "./draftMime.ts";

Deno.test("Entwurf: Umlaute, Threading-Kopfzeilen, kein Transport", async () => {
  const raw = await buildDraftMime({
    from: { name: "SL WERBUNG", address: "info@slwerbung.de" }, to: "kunde@x.de", subject: "AW: Größe & Übung",
    text: "Hallo Frau Müller,\n\ndas Layout kommt [[Termin nennen]].\n\nViele Grüße", messageId: "<neu@slwerbung.de>",
    inReplyTo: "<orig@x.de>", references: ["<alt@x.de>", "<orig@x.de>"],
  });
  const p = await simpleParser(raw as any);
  assertEquals(p.subject, "AW: Größe & Übung");
  assertEquals(p.messageId, "<neu@slwerbung.de>");
  assertEquals(p.inReplyTo, "<orig@x.de>");
  assertEquals(p.references, ["<alt@x.de>", "<orig@x.de>"]);
  assert(String(p.text).includes("Frau Müller"));
  assert(String(p.text).includes("[[Termin nennen]]"));
  assertEquals(p.from?.value[0].address, "info@slwerbung.de");
  assertEquals(p.to && !Array.isArray(p.to) ? p.to.value[0].address : "", "kunde@x.de");
  assert(p.date instanceof Date);
  assert(new TextDecoder().decode(raw).toLowerCase().includes("x-mail-assistent: entwurf"));
});

Deno.test("Message-ID traegt die Domain des Postfachs", () => {
  assert(/^<[0-9a-f-]{36}@slwerbung\.de>$/.test(newMessageId("info@slwerbung.de")));
});
