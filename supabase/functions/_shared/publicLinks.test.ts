import { describe, expect, it } from "vitest";
import { publicUrl, resolvePublicLinkConfig, slugify, validateBaseUrl, validateSlug } from "./publicLinks.ts";

describe("publicLinks", () => {
  it("slugify: Firmenname → Pfad", () => {
    expect(slugify("SL WERBUNG")).toBe("sl-werbung");
    expect(slugify("Müller & Söhne GmbH")).toBe("mueller-soehne-gmbh");
    expect(slugify("  Straße  ")).toBe("strasse");
    expect(slugify("Café Noël")).toBe("cafe-noel");
    expect(slugify("--a--b--")).toBe("a-b");
  });
  it("publicUrl ohne doppelte Schrägstriche", () => {
    const cfg = { slug: "sl-werbung", baseUrl: "https://captfix.app/" };
    expect(publicUrl(cfg, "/freigabe/123")).toBe("https://captfix.app/sl-werbung/freigabe/123");
    expect(publicUrl({ slug: "x", baseUrl: "https://freigabe.slwerbung.de" }, "termin/m/lang")).toBe("https://freigabe.slwerbung.de/x/termin/m/lang");
  });
  it("Standardwerte: Slug aus Firmenname, captfix.app", () => {
    expect(resolvePublicLinkConfig({ companyName: "SL WERBUNG" })).toEqual({ slug: "sl-werbung", baseUrl: "https://captfix.app" });
    expect(resolvePublicLinkConfig({ slug: "eigen", baseUrl: "https://a.de", companyName: "X" })).toEqual({ slug: "eigen", baseUrl: "https://a.de" });
  });
  it("Validierung", () => {
    expect(validateSlug("sl-werbung")).toBeNull();
    expect(validateSlug("Admin")).not.toBeNull();
    expect(validateSlug("admin")).not.toBeNull();
    expect(validateSlug("a")).not.toBeNull();
    expect(validateSlug("sl werbung")).not.toBeNull();
    expect(validateBaseUrl("https://freigabe.slwerbung.de")).toBeNull();
    expect(validateBaseUrl("http://x.de")).not.toBeNull();
    expect(validateBaseUrl("https://x.de/")).not.toBeNull();
    expect(validateBaseUrl("https://x.de/pfad")).not.toBeNull();
  });
});
