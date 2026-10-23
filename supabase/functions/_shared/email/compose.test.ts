import { describe, expect, it } from "vitest";
import {
  checkRecipients, ComposeError, composeBody, forwardSubject, htmlToText, parseAddressList, quoteBlock, referenceChain,
  replyAllRecipients, replySubject,
} from "./compose";

describe("parseAddressList", () => {
  it("liest Listen mit Namen und Trennern, ohne Doppelte", () => {
    expect(parseAddressList("a@x.de, Max Muster <B@y.de>; c@z.de\na@x.de")).toEqual(["a@x.de", "b@y.de", "c@z.de"]);
    expect(parseAddressList(["d@x.de"])).toEqual(["d@x.de"]);
    expect(parseAddressList("")).toEqual([]);
  });
  it("lehnt ungueltige Adressen ab", () => {
    expect(() => parseAddressList("kein-at")).toThrow(ComposeError);
    expect(() => parseAddressList("a@b")).toThrow(ComposeError);
  });
});

describe("checkRecipients", () => {
  it("verlangt einen Empfaenger in An", () => {
    expect(() => checkRecipients({ to: [], cc: ["a@x.de"], bcc: [] })).toThrow(/mindestens/);
  });
  it("begrenzt die Zahl", () => {
    const many = Array.from({ length: 51 }, (_, i) => `a${i}@x.de`);
    expect(() => checkRecipients({ to: many, cc: [], bcc: [] })).toThrow(/Höchstens/);
  });
});

describe("Betreff", () => {
  it("setzt AW:/WG: nur einmal", () => {
    expect(replySubject("Angebot")).toBe("AW: Angebot");
    expect(replySubject("Re: Angebot")).toBe("Re: Angebot");
    expect(replySubject("AW: Angebot")).toBe("AW: Angebot");
    expect(forwardSubject("Rechnung")).toBe("WG: Rechnung");
    expect(forwardSubject("Fwd: Rechnung")).toBe("Fwd: Rechnung");
  });
});

describe("htmlToText / composeBody", () => {
  it("macht aus der HTML-Signatur lesbaren Text", () => {
    expect(htmlToText("<p>Viele Gr&uuml;&szlig;e</p><p><b>SL WERBUNG</b><br>Tel. 123</p><style>x{}</style>")).toBe("Viele Gr&uuml;&szlig;e\nSL WERBUNG\nTel. 123");
  });
  it("haengt die Signatur an Text und HTML, darunter das Zitat", () => {
    const q = quoteBlock({ from: "Kunde <k@x.de>", date: "2026-10-20T08:00:00Z", text: "Hallo\nWelt" }, "reply");
    const b = composeBody("Guten Tag,\n\ndanke.", "<b>Gruß</b>", q);
    expect(b.text).toBe("Guten Tag,\n\ndanke.\n\n-- \nGruß\n\nAm 20.10.2026, 10:00 schrieb Kunde <k@x.de>:\n> Hallo\n> Welt");
    expect(b.html).toContain('<div class="signature"><b>Gruß</b></div>');
    expect(b.html).toContain("Kunde &lt;k@x.de&gt;");
    expect(b.html.indexOf("signature")).toBeLessThan(b.html.indexOf("blockquote"));
  });
  it("ohne Signatur und Zitat bleibt nur der Text", () => {
    expect(composeBody("Hi  \n", null, null).text).toBe("Hi");
  });
  it("Weiterleitung zeigt Kopfdaten", () => {
    const q = quoteBlock({ from: "a@x.de", date: null, text: "Text", subject: "Rechnung", to: ["info@slwerbung.de"] }, "forward");
    expect(q.text).toBe("-------- Weitergeleitete Nachricht --------\nVon: a@x.de\nAn: info@slwerbung.de\nBetreff: Rechnung\n\nText");
  });
});

describe("referenceChain / replyAllRecipients", () => {
  it("haengt die beantwortete Message-ID an", () => {
    expect(referenceChain({ message_id: "<b@x>", refs: ["<a@x>", "<b@x>"] })).toEqual({ inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] });
    expect(referenceChain({ message_id: null, refs: null })).toEqual({ inReplyTo: null, references: [] });
  });
  it("Allen antworten ohne eigene Adressen", () => {
    expect(replyAllRecipients(
      { from_addr: "Kunde@x.de", to_addrs: ["info@slwerbung.de", "kollege@x.de"], cc_addrs: ["kunde@x.de", "chef@x.de"] },
      ["INFO@slwerbung.de"],
    )).toEqual({ to: ["kunde@x.de"], cc: ["kollege@x.de", "chef@x.de"], bcc: [] });
  });
});

describe("stripTrailingSignature", () => {
  it("nimmt die Text-Signatur am Ende weg, sonst nichts", async () => {
    const { stripTrailingSignature } = await import("./compose");
    expect(stripTrailingSignature("Hallo\n\nViele Grüße\nSL WERBUNG\n", "Viele Grüße\nSL WERBUNG")).toBe("Hallo");
    expect(stripTrailingSignature("Hallo", "Gruß")).toBe("Hallo");
    expect(stripTrailingSignature("Hallo", "")).toBe("Hallo");
  });
});
