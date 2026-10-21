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
