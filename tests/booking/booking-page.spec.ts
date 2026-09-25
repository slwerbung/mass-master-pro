// Oberflaechen-Tests der Terminbuchung gegen abgefangene API-Antworten.
//
// Die Rechenlogik haengt an Unit-Tests, die Edge Functions wurden gegen die
// echte Datenbank geprueft. Was hier fehlt, ist das Dazwischen: zeigt die Seite
// die Antwort richtig an, kommt beim Buchen das Richtige an, und fragen die
// Absage-Seiten nach, bevor sie handeln? Genau das steht hier.

import { test, expect, type Page } from "@playwright/test";
import { DateTime } from "luxon";

const PROJEKT = "11111111-2222-3333-4444-555555555555";
const MITARBEITER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Drei Termine an einem Tag, der sicher in der Zukunft liegt. */
function slots() {
  const tag = DateTime.now().setZone("Europe/Berlin").plus({ days: 3 }).startOf("day");
  return [9, 11, 14].map((h) => ({
    startsAt: tag.set({ hour: h }).toUTC().toISO(),
    endsAt: tag.set({ hour: h }).plus({ minutes: 90 }).toUTC().toISO(),
    assignedStaffId: MITARBEITER,
  }));
}

const AUFMASS = { key: "aufmass_vor_ort", label: "Aufmass vor Ort", durationMinutes: 90, formFields: [], bookingWindowDays: 60 };
const MONTAGE = { key: "montage_vor_ort", label: "Montage vor Ort", durationMinutes: 480, formFields: [], bookingWindowDays: 60 };

const kontext = {
  project: { id: PROJEKT, number: "WER-1234", customerName: "Musterfirma GmbH", heroLinked: true },
  // Eine Terminart: die Seite geht direkt in den Kalender.
  appointments: [AUFMASS],
  address: {
    street: "Hauptstr. 1", zipcode: "71332", city: "Waiblingen",
    text: "Hauptstr. 1, 71332 Waiblingen", source: "project", located: true,
  },
  contact: { name: "Erika Muster", email: "erika@example.org", phone: "07151 1234" },
};

/** Faengt alle Aufrufe der Buchungs-API ab und merkt sich, was gesendet wurde. */
async function stub(page: Page, opts: { onCreate?: (body: any) => any; arten?: any[] } = {}) {
  const gesendet: any[] = [];
  await page.route("**/functions/v1/booking-api**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (req.method() === "GET" || url.searchParams.get("action")) {
      const action = url.searchParams.get("action");
      if (action === "context") {
        return json(opts.arten ? { ...kontext, appointments: opts.arten } : kontext);
      }
      if (action === "availability") {
        // Die Terminart MUSS mitkommen, sonst wuesste der Server nicht, was
        // gerechnet werden soll.
        gesendet.push({ action: "availability", ruleSet: url.searchParams.get("ruleSet") });
        return json({ slots: slots(), addressLocated: true });
      }
    }
    const body = req.postDataJSON?.() ?? {};
    gesendet.push(body);
    if (body.action === "create") {
      const antwort = opts.onCreate?.(body);
      if (antwort) return json(antwort.body, antwort.status ?? 200);
      return json({
        ok: true,
        booking: { id: "b1", status: "confirmed", startsAt: body.slot.startsAt, endsAt: body.slot.endsAt },
        cancelToken: "tok", heroError: null, mailQueued: true,
      });
    }
    if (body.action === "cancel") return json({ ok: true, status: "cancelled", heroRemoved: true });
    if (body.action === "staff-action") {
      return json({ ok: true, status: "cancelled", mode: body.mode, projectId: PROJEKT, heroRemoved: true });
    }
    return json({ error: "unerwartet" }, 400);
  });
  return gesendet;
}

test.describe("Buchungsseite", () => {
  test("zeigt Anlass, Dauer und Adresse aus HERO", async ({ page }) => {
    await stub(page);
    await page.goto(`/termin/${PROJEKT}`);

    await expect(page.getByRole("heading", { name: "Aufmass vor Ort" })).toBeVisible();
    await expect(page.getByText("90 Minuten")).toBeVisible();
    await expect(page.getByText("Hauptstr. 1, 71332 Waiblingen")).toBeVisible();
    await expect(page.getByText("Projekt WER-1234")).toBeVisible();
  });

  test("bietet die freien Zeiten an und fuehrt zur Bestaetigung", async ({ page }) => {
    await stub(page);
    await page.goto(`/termin/${PROJEKT}`);

    // Drei Zeiten, in Berliner Zeit beschriftet.
    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    await expect(page.getByRole("button", { name: "11:00" })).toBeVisible();
    await expect(page.getByRole("button", { name: "14:00" })).toBeVisible();

    await page.getByRole("button", { name: "11:00" }).click();

    // Kontaktdaten sind aus HERO vorbelegt — und editierbar.
    await expect(page.getByLabel("Name *")).toHaveValue("Erika Muster");
    await expect(page.getByLabel("E-Mail *")).toHaveValue("erika@example.org");
    await expect(page.getByText("Ihr Termin")).toBeVisible();
  });

  test("schickt genau das ab, was ausgewaehlt wurde", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto(`/termin/${PROJEKT}`);

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByLabel("Name *").fill("Neuer Name");
    await page.getByLabel("Hinweis für uns (optional)").fill("Leiter noetig");
    await page.getByRole("button", { name: "Termin bestätigen" }).click();

    await expect(page.getByText("Termin steht")).toBeVisible();

    const buchung = gesendet.find((b) => b.action === "create");
    expect(buchung).toBeTruthy();
    expect(buchung.project).toBe(PROJEKT);
    expect(buchung.staffId).toBe(MITARBEITER);
    expect(buchung.contact.name).toBe("Neuer Name");
    expect(buchung.contact.email).toBe("erika@example.org");
    expect(buchung.hinweis).toBe("Leiter noetig");
    expect(buchung.slot.startsAt).toBe(slots()[0].startsAt);
  });

  test("besteht auf Name und E-Mail", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto(`/termin/${PROJEKT}`);

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByLabel("E-Mail *").fill("");
    await page.getByRole("button", { name: "Termin bestätigen" }).click();

    await expect(page.getByText("Bitte Name und E-Mail angeben.")).toBeVisible();
    expect(gesendet.some((b) => b.action === "create")).toBe(false);
  });

  test("faengt einen inzwischen vergebenen Termin ab", async ({ page }) => {
    // 409: zwischen Anzeigen und Buchen war jemand schneller.
    await stub(page, {
      onCreate: () => ({ status: 409, body: { error: "Dieser Termin wurde gerade vergeben." } }),
    });
    await page.goto(`/termin/${PROJEKT}`);

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByRole("button", { name: "Termin bestätigen" }).click();

    await expect(page.getByText("Dieser Termin wurde gerade vergeben.")).toBeVisible();
    // Zurueck in die Auswahl, damit der Kunde gleich weiterklicken kann.
    await expect(page.getByRole("button", { name: "11:00" })).toBeVisible();
  });

  test("laesst die Adresse aendern", async ({ page }) => {
    await stub(page);
    await page.goto(`/termin/${PROJEKT}`);

    await page.getByRole("button", { name: "Adresse ändern" }).click();
    await page.getByLabel("Straße und Nr.").fill("Neue Str. 5");
    await page.getByLabel("PLZ").fill("71364");
    await page.getByLabel("Ort").fill("Winnenden");
    await page.getByRole("button", { name: "Übernehmen" }).click();

    await expect(page.getByText("Neue Str. 5, 71364 Winnenden")).toBeVisible();
  });

  test("sagt es, wenn der Link nicht funktioniert", async ({ page }) => {
    await page.route("**/functions/v1/booking-api**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Projekt nicht gefunden" }) }));
    await page.goto(`/termin/${PROJEKT}`);

    await expect(page.getByText("Dieser Buchungslink funktioniert nicht.")).toBeVisible();
  });
});

test.describe("Absage durch den Kunden", () => {
  test("fragt nach, bevor sie absagt", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto("/termin/absagen/tok-123");

    // Ein Mailprogramm, das Links vorab anklickt, darf nichts ausloesen.
    await expect(page.getByText("Termin absagen?")).toBeVisible();
    expect(gesendet.length).toBe(0);

    await page.getByRole("button", { name: "Ja, Termin absagen" }).click();
    await expect(page.getByText("Termin ist abgesagt")).toBeVisible();
    expect(gesendet[0]).toMatchObject({ action: "cancel", cancelToken: "tok-123" });
  });
});

test.describe("Interne Aktion aus der Mail", () => {
  test("Umbuchen fragt nach und meldet den freien Platz", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto("/termin/intern/staff-1?mode=reschedule");

    await expect(page.getByText("Kunden um einen neuen Termin bitten?")).toBeVisible();
    await page.getByRole("button", { name: "Ja, umbuchen lassen" }).click();

    await expect(page.getByText("Umbuchung angestoßen")).toBeVisible();
    await expect(page.getByText(/Platz ist wieder frei/)).toBeVisible();
    expect(gesendet[0]).toMatchObject({ action: "staff-action", staffToken: "staff-1", mode: "reschedule" });
  });

  test("Absagen ist der andere Weg", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto("/termin/intern/staff-1?mode=cancel");

    await expect(page.getByText("Termin endgültig absagen?")).toBeVisible();
    await page.getByRole("button", { name: "Ja, absagen" }).click();

    await expect(page.getByText("Termin abgesagt")).toBeVisible();
    expect(gesendet[0]).toMatchObject({ action: "staff-action", mode: "cancel" });
  });

  test("warnt, wenn der HERO-Termin stehen blieb", async ({ page }) => {
    await page.route("**/functions/v1/booking-api**", (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, status: "cancelled", mode: "cancel", projectId: PROJEKT, heroRemoved: false }),
      }));
    await page.goto("/termin/intern/staff-1?mode=cancel");
    await page.getByRole("button", { name: "Ja, absagen" }).click();

    await expect(page.getByText(/In HERO liess sich der Termin nicht entfernen/)).toBeVisible();
  });
});

test.describe("Mehrere Terminarten", () => {
  test("laesst erst waehlen und rechnet dann mit der gewaehlten Art", async ({ page }) => {
    const gesendet = await stub(page, { arten: [AUFMASS, MONTAGE] });
    await page.goto(`/termin/${PROJEKT}`);

    // Auswahl zuerst, kein Kalender.
    await expect(page.getByRole("heading", { name: "Termin vereinbaren" })).toBeVisible();
    await expect(page.getByText("Aufmass vor Ort")).toBeVisible();
    await expect(page.getByText("Montage vor Ort")).toBeVisible();
    await expect(page.getByText("480 Minuten")).toBeVisible();
    expect(gesendet.some((g) => g.action === "availability")).toBe(false);

    await page.getByText("Montage vor Ort").click();

    // Erst jetzt werden Zeiten geholt — fuer die gewaehlte Art.
    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.ruleSet).toBe("montage_vor_ort");

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByRole("button", { name: "Termin bestätigen" }).click();
    await expect(page.getByText("Termin steht")).toBeVisible();
    expect(gesendet.find((b) => b.action === "create").ruleSet).toBe("montage_vor_ort");
  });

  test("laesst zurueck zur Auswahl", async ({ page }) => {
    await stub(page, { arten: [AUFMASS, MONTAGE] });
    await page.goto(`/termin/${PROJEKT}`);
    await page.getByText("Aufmass vor Ort").click();
    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();

    await page.getByRole("button", { name: "andere Terminart" }).click();
    await expect(page.getByRole("heading", { name: "Termin vereinbaren" })).toBeVisible();
  });

  test("bei einer einzigen Art entfaellt die Auswahl", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto(`/termin/${PROJEKT}`);

    await expect(page.getByRole("heading", { name: "Aufmass vor Ort" })).toBeVisible();
    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    expect(gesendet.find((g) => g.action === "availability").ruleSet).toBe("aufmass_vor_ort");
  });
});
