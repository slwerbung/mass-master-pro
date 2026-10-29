import { describe, expect, it } from "vitest";
import { attachmentParts, htmlToText, omittedNote, slimSource } from "./bigMail.ts";

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
});
