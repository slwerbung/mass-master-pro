import { describe, expect, it } from "vitest";
import { buildNewVersionMail } from "./newVersionMail.ts";

describe("Kundenmail „Neue Version“ (Spec D1)", () => {
  it("Betreff, Standortliste, Änderungsnotiz, Firmen-Link; nie Captfix", () => {
    const m = buildNewVersionMail({
      companyName: "Muster GmbH", projectNumber: "WER-12", link: "https://x.de/muster/freigabe/P",
      items: [{ label: "Standort 1 · Eingang", version: 2 }, { label: "Standort 2", version: 3 }], note: "Logo <größer>", resetApproval: true,
    });
    expect(m.subject).toBe("Neue Version zur Freigabe – Projekt WER-12");
    expect(m.html).toContain("Standort 1 · Eingang");
    expect(m.html).toContain("(Version 3)");
    expect(m.html).toContain("Logo &lt;größer&gt;");
    expect(m.html).toContain("https://x.de/muster/freigabe/P");
    expect(m.html).toContain("erneut frei");
    expect(m.text).toContain("- Standort 2 (Version 3)");
    expect(m.html + m.text).not.toMatch(/captfix/i);
    expect(buildNewVersionMail({ companyName: "M", projectNumber: "1", link: "l", items: [], resetApproval: false }).html).not.toContain("erneut frei");
  });
});
