import { describe, expect, it } from "vitest";
import { inlineCidImages, mailHtml, textToHtml, toBase64 } from "./mailHtml.ts";

describe("Mail-HTML", () => {
  it("ersetzt eingebettete Bilder (cid) durch data:-URLs, nur Bilder und nur referenzierte", () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const html = '<img src="cid:logo@x"><img src="CID:logo@x">';
    const out = inlineCidImages(html, [
      { cid: "<logo@x>", mime: "image/png", content: png },
      { cid: "doc@x", mime: "application/pdf", content: png },
      { cid: "unused@x", mime: "image/png", content: png },
    ]);
    expect(out).toBe(`<img src="data:image/png;base64,${toBase64(png)}"><img src="data:image/png;base64,${toBase64(png)}">`);
  });
  it("zu grosse Bilder bleiben cid (werden nicht eingebettet)", () => {
    const big = new Uint8Array(1_600_000);
    expect(inlineCidImages('<img src="cid:a">', [{ cid: "a", mime: "image/jpeg", content: big }])).toBe('<img src="cid:a">');
  });
  it("Text-Mails werden sicher als HTML gezeigt, Links klickbar", () => {
    const h = textToHtml("Hallo <script>x</script>\nhttps://slwerbung.de/a?b=1");
    expect(h).not.toContain("<script>");
    expect(h).toContain('<a href="https://slwerbung.de/a?b=1">');
    expect(mailHtml({ html: false, text: "Nur Text" })).toMatchObject({ kind: "text" });
    expect(mailHtml({ html: "<p>Hi</p>", text: "Hi" })).toEqual({ html: "<p>Hi</p>", kind: "html" });
  });
});

describe("nur sichtbare Teile (BODYSTRUCTURE)", async () => {
  const { pickDisplayParts, decodeTransfer, decodeCharset } = await import("./mailHtml");
  it("HTML, Text und eingebettetes Logo – PDF-Anhang und angehaengte Mail nicht", () => {
    const p = pickDisplayParts({
      type: "multipart/mixed", childNodes: [
        { part: "1", type: "multipart/related", childNodes: [
          { part: "1.1", type: "multipart/alternative", childNodes: [
            { part: "1.1.1", type: "text/plain", parameters: { charset: "iso-8859-1" }, encoding: "quoted-printable", size: 500 },
            { part: "1.1.2", type: "text/html", parameters: { charset: "utf-8" }, encoding: "base64", size: 2000 },
          ] },
          { part: "1.2", type: "image/jpeg", id: "<image001.jpg@01DD>", encoding: "base64", size: 40000, disposition: "inline" },
        ] },
        { part: "2", type: "application/pdf", encoding: "base64", size: 4_500_000, disposition: "attachment" },
        { part: "3", type: "message/rfc822", childNodes: [{ part: "3.1", type: "text/html", size: 10 }] },
      ],
    });
    expect(p.html).toEqual({ key: "1.1.2", charset: "utf-8", encoding: "base64", size: 2000 });
    expect(p.text?.key).toBe("1.1.1");
    expect(p.images.map((i) => [i.key, i.cid, i.mime])).toEqual([["1.2", "<image001.jpg@01DD>", "image/jpeg"]]);
  });
  it("einteilige Mail = TEXT", () => {
    expect(pickDisplayParts({ type: "text/plain", parameters: { charset: "utf-8" }, encoding: "7bit", size: 10 }).text?.key).toBe("text");
  });
  it("dekodiert base64, quoted-printable und Zeichensaetze", () => {
    const enc = new TextEncoder();
    expect(decodeCharset(decodeTransfer(enc.encode(btoa("<p>Hallo</p>")), "base64"), "utf-8")).toBe("<p>Hallo</p>");
    expect(decodeCharset(decodeTransfer(enc.encode("Gr=FC=DFe=\r\n Peter"), "quoted-printable"), "iso-8859-1")).toBe("Grüße Peter");
    expect(decodeCharset(decodeTransfer(enc.encode("Gr=C3=BC=C3=9Fe"), "quoted-printable"), "utf-8")).toBe("Grüße");
    expect(decodeCharset(new Uint8Array([0x47, 0x72, 0xfc]), null)).toBe("Grü"); // kaputtes UTF-8 -> 1252
  });
});
