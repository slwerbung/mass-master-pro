import { describe, expect, it } from "vitest";
import { attachmentParts, attachmentRefs, decodeBase64Bytes, decodePart, htmlToText, omittedNote, slimSource, slimText, tooBigNote } from "./bigMail.ts";
import { cleanBody } from "./mail.ts";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

describe("bigMail", () => {
  it("slimSource behaelt Kopfzeilen, ersetzt die MIME-Struktur durch text/plain", () => {
    const head = bytes(
      "Message-ID: <a@b>\r\nIn-Reply-To: <x@y>\r\nContent-Type: multipart/mixed;\r\n boundary=\"zzz\"\r\nSubject: Druckdaten\r\nMIME-Version: 1.0\r\n\r\n",
    );
    const out = new TextDecoder().decode(slimSource(head, "Hallo Grüße"));
    expect(out).toContain("Message-ID: <a@b>\r\nIn-Reply-To: <x@y>\r\nSubject: Druckdaten\r\n");
    expect(out).not.toMatch(/multipart|boundary/);
    expect(out).toMatch(/Content-Type: text\/plain; charset=utf-8\r\n.*\r\n\r\nHallo Grüße$/s);
    expect(out.match(/MIME-Version/g)?.length).toBe(1);
  });

  it("8-bit-Kopfzeilen bleiben Byte fuer Byte erhalten", () => {
    const head = new Uint8Array([...bytes("Subject: "), 0xc3, 0xa4, ...bytes("\r\n\r\n")]);
    expect(latin1(slimSource(head, "x")).startsWith("Subject: Ã¤\r\n")).toBe(true);
  });

  it("attachmentParts listet Anhaenge, nicht Text und eingebettete Bilder", () => {
    const root: any = {
      type: "multipart/mixed", childNodes: [
        { type: "multipart/alternative", childNodes: [{ type: "text/plain", part: "1.1", size: 10 }, { type: "text/html", part: "1.2", size: 20 }] },
        { type: "image/png", part: "2", id: "<logo>", size: 100, encoding: "base64" },
        { type: "application/pdf", part: "3", disposition: "attachment", dispositionParameters: { filename: "Druck.pdf" }, size: 4000, encoding: "base64" },
      ],
    };
    expect(attachmentParts(root)).toEqual([{ name: "Druck.pdf", size: 3000 }]);
  });

  it("omittedNote und htmlToText", () => {
    expect(omittedNote(25 * 1024 * 1024, [{ name: "a.pdf", size: 24 * 1024 * 1024 }])).toBe(
      "[Mail mit 25,0 MB – zu groß zum vollständigen Abholen. Anhänge nicht übernommen: a.pdf (24,0 MB). Im Mailprogramm öffnen.]",
    );
    expect(htmlToText("<style>x{}</style><p>Hallo&nbsp;Welt</p><p>A &amp; B</p>")).toBe("Hallo Welt\nA & B");
  });

  it("attachmentRefs: Teilnummer, Name, Kodierung; eingebettete Bilder als inline, Text nicht", () => {
    const root: any = {
      type: "multipart/mixed", childNodes: [
        { type: "multipart/related", childNodes: [{ type: "text/html", part: "1.1", size: 20 }, { type: "image/jpeg", part: "1.2", id: "<sig>", size: 24000, encoding: "base64" }] },
        { type: "application/pdf", part: "2", disposition: "attachment", dispositionParameters: { filename: "Plan.pdf" }, size: 12_000_000, encoding: "base64" },
        { type: "message/rfc822", part: "3", size: 500, encoding: "7bit", childNodes: [{ type: "text/plain", part: "3.1" }] },
      ],
    };
    expect(attachmentRefs(root)).toEqual([
      { key: "1.2", filename: "anhang", mime: "image/jpeg", encoding: "base64", size: 18000, inline: true },
      { key: "2", filename: "Plan.pdf", mime: "application/pdf", encoding: "base64", size: 9_000_000, inline: false },
      { key: "3", filename: "weitergeleitete-mail.eml", mime: "message/rfc822", encoding: "7bit", size: 500, inline: false },
    ]);
  });

  it("decodeBase64Bytes = atob, auch mit Zeilenumbruechen und Padding", () => {
    const raw = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 0xff);
    for (const len of [0, 1, 2, 3, 4, 5, 999, 1000]) {
      const part = raw.subarray(0, len);
      const b64 = Buffer.from(part).toString("base64").replace(/(.{76})/g, "$1\r\n");
      expect(Array.from(decodeBase64Bytes(bytes(b64)))).toEqual(Array.from(part));
    }
    expect(new TextDecoder().decode(decodePart(bytes("Gr=C3=BC=\r\nsse"), "quoted-printable"))).toBe("Grüsse");
  });

  it("Hinweis steht oben und ueberlebt das Abschneiden ab dem Zitat (weitergeleitete Mail)", () => {
    const note = tooBigNote([{ name: "riesig.zip", size: 30 * 1024 * 1024 }]);
    expect(note).toBe("[Anhang zu groß zum Übernehmen: riesig.zip (30,0 MB). Im Mailprogramm öffnen.]");
    const text = "Guten Tag,\n\nViele Grüße\n----- Weitergeleitet von X am 12.11.2026 09:48 -----\n\nVon: X\nAn: info@slwerbung.de\nDatum: 12.11.2026\nBetreff: Anfrage\n\nAlter Text";
    expect(cleanBody(slimText(text, note))).toContain("riesig.zip");
    expect(slimText(" Hallo ", null)).toBe("Hallo");
  });
});
