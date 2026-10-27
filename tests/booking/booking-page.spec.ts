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
/** Dauer je Einladung einstellbar — der Anlass fuer `?d=`/`/d240`. */
const MONTAGE_WAEHLBAR = {
  ...MONTAGE, durationChoosable: true, durationMin: 60, durationMax: 600,
};
const TELEFON = {
  key: "telefontermin", label: "Telefontermin", durationMinutes: 30,
  formFields: [], bookingWindowDays: 60, locationMode: "telefon",
};
const ONLINE = {
  key: "onlinetermin", label: "Onlinetermin", durationMinutes: 45,
  formFields: [], bookingWindowDays: 60, locationMode: "online",
};
const BUERO = {
  key: "buerotermin", label: "Beratung im Büro", durationMinutes: 60,
  formFields: [], bookingWindowDays: 60, locationMode: "buero",
};

const kontext = {
  project: { id: PROJEKT, number: "WER-1234", customerName: "Musterfirma GmbH", heroLinked: true },
  staff: null as null | { name: string; slug: string },
  // Eine Terminart: die Seite geht direkt in den Kalender.
  appointments: [AUFMASS],
  address: {
    street: "Hauptstr. 1", zipcode: "71332", city: "Waiblingen",
    text: "Hauptstr. 1, 71332 Waiblingen", source: "project", located: true,
  },
  contact: { name: "Erika Muster", email: "erika@example.org", phone: "07151 1234" },
  office: "Otto-Hahn-Straße 3, 71364 Winnenden",
};

/** Dauerlink eines Mitarbeiters: kein Projekt, also auch keine Adresse. */
const kontextOhneProjekt = {
  project: null,
  staff: { name: "Langner", slug: "langner" },
  appointments: [AUFMASS],
  address: null,
  contact: { name: "", email: null, phone: null },
  office: "Otto-Hahn-Straße 3, 71364 Winnenden",
};

/** Faengt alle Aufrufe der Buchungs-API ab und merkt sich, was gesendet wurde. */
async function stub(
  page: Page,
  opts: {
    onCreate?: (body: any) => any; arten?: any[]; projektFehlt?: boolean;
    /** Was der Server als gerechnete Dauer meldet. */
    dauer?: number;
    /** Was `create` als Treffpunkt/Videolink zurueckmeldet. */
    meetingUrl?: string; treffpunkt?: string;
  } = {},
) {
  const gesendet: any[] = [];
  await page.route("**/functions/v1/booking-api**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (req.method() === "GET" || url.searchParams.get("action")) {
      const action = url.searchParams.get("action");
      if (action === "context") {
        // Ohne `project` ist es der Dauerlink eines Mitarbeiters.
        // `p` ist die HERO-Projektnummer: der Server loest sie auf, fuer die
        // Seite ist das Ergebnis dasselbe wie bei unserer UUID.
        // Projektnummer im Link, Projekt aber nicht auffindbar: der Server
        // sperrt deswegen nicht aus, er sagt es nur.
        const basis = opts.projektFehlt
          ? { ...kontextOhneProjekt, projectMissing: true, staff: { name: "Langner", slug: "langner" } }
          : (url.searchParams.get("project") || url.searchParams.get("p"))
            ? { ...kontext, staff: url.searchParams.get("staff") ? { name: "Langner", slug: "langner" } : null }
            : kontextOhneProjekt;
        return json(opts.arten ? { ...basis, appointments: opts.arten } : basis);
      }
      if (action === "availability") {
        // Terminart und Mitarbeiter MUESSEN mitkommen, sonst wuesste der
        // Server nicht, was fuer wen gerechnet werden soll.
        gesendet.push({
          action: "availability",
          ruleSet: url.searchParams.get("ruleSet"),
          project: url.searchParams.get("project"),
          projectNr: url.searchParams.get("p"),
          staff: url.searchParams.get("staff"),
          d: url.searchParams.get("d"),
        });
        return json({
          slots: slots(), addressLocated: true,
          durationMinutes: opts.dauer ?? 90,
        });
      }
    }
    const body = req.postDataJSON?.() ?? {};
    gesendet.push(body);
    if (body.action === "create") {
      const antwort = opts.onCreate?.(body);
      if (antwort) return json(antwort.body, antwort.status ?? 200);
      return json({
        ok: true,
        booking: {
          id: "b1", status: "confirmed",
          startsAt: body.slot.startsAt,
          // Das Ende rechnet der Server — die Seite schickt es nicht mehr mit.
          endsAt: DateTime.fromISO(body.slot.startsAt, { zone: "utc" })
            .plus({ minutes: opts.dauer ?? 90 }).toISO(),
          ...(opts.meetingUrl ? { meetingUrl: opts.meetingUrl } : {}),
          ...(opts.treffpunkt ? { treffpunkt: opts.treffpunkt } : {}),
        },
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
    // Gelesen wird die Dauer, nicht gerechnet: 90 Minuten sind "1,5 Stunden".
    await expect(page.getByText("1,5 Stunden")).toBeVisible();
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
    await expect(page.getByText("8 Stunden")).toBeVisible();
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

// Der Termin gehoert dem, der eingeladen hat. Deshalb muss der Mitarbeiter aus
// dem Link bei JEDER Anfrage mitgehen — sonst rechnet der Server ueber alle und
// der Termin landete beim Falschen.
test.describe("Einladung eines Mitarbeiters", () => {
  test("Dauerlink ohne Projekt: fragt die Adresse ab und nennt den Mitarbeiter", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto("/termin/m/langner");

    await expect(page.getByRole("heading", { name: "Aufmass vor Ort" })).toBeVisible();
    await expect(page.getByText("mit Langner")).toBeVisible();
    // Ohne Projekt gibt es keine Adresse aus HERO: die Felder stehen offen.
    await expect(page.getByLabel("Straße und Nr.")).toBeVisible();

    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.staff).toBe("langner");
    expect(abfrage.project).toBe(null);

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByLabel("Name *").fill("Neuer Kunde");
    await page.getByLabel("E-Mail *").fill("kunde@example.org");
    await page.getByRole("button", { name: "Termin bestätigen" }).click();
    await expect(page.getByText("Termin steht")).toBeVisible();

    const buchung = gesendet.find((b) => b.action === "create");
    expect(buchung.staff).toBe("langner");
    expect(buchung.project).toBe(null);
  });

  test("Terminart aus dem Link: der Kunde waehlt sie nicht mehr", async ({ page }) => {
    // Zwei Arten verfuegbar, aber die Einladung nennt eine - dann darf keine
    // Auswahl erscheinen und auch kein Weg zurueck dazu.
    const gesendet = await stub(page, { arten: [AUFMASS, MONTAGE] });
    await page.goto("/termin/m/langner?art=montage_vor_ort");

    await expect(page.getByRole("heading", { name: "Montage vor Ort" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Termin vereinbaren" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "andere Terminart" })).toHaveCount(0);

    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.ruleSet).toBe("montage_vor_ort");
    expect(abfrage.staff).toBe("langner");
  });

  test("unbekannte Terminart im Link: dann darf der Kunde doch waehlen", async ({ page }) => {
    // Eine abgeschaltete Terminart soll nicht in eine leere Seite fuehren.
    await stub(page, { arten: [AUFMASS, MONTAGE] });
    await page.goto("/termin/m/langner?art=gibt_es_nicht_mehr");

    await expect(page.getByRole("heading", { name: "Termin vereinbaren" })).toBeVisible();
    await expect(page.getByText("Montage vor Ort")).toBeVisible();
  });

  test("Link aus einer HERO-Vorlage: Nachname und Projektnummer gehen mit", async ({ page }) => {
    // So sieht der Link aus, wenn HERO die Platzhalter gefuellt hat:
    // {{Partner.last_name}} -> Langner, {{ProjectMatch.display_id}} -> 1744.
    const gesendet = await stub(page);
    await page.goto("/termin/m/Langner?art=aufmass_vor_ort&p=1744");

    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();

    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.staff).toBe("Langner");     // Gross-/Kleinschreibung loest der Server auf
    expect(abfrage.projectNr).toBe("1744");
    expect(abfrage.project).toBe(null);

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByRole("button", { name: "Termin bestätigen" }).click();
    await expect(page.getByText("Termin steht")).toBeVisible();

    const buchung = gesendet.find((b) => b.action === "create");
    expect(buchung.projectNr).toBe("1744");
    expect(buchung.staff).toBe("Langner");
  });

  test("Vorlagenform im Pfad: Nachname, Projektnummer und Terminart", async ({ page }) => {
    // Die Form, die HERO-Mailvorlagen bekommen. Kein Query-Parameter mehr: der
    // Vorlagen-Editor hatte den Link hinter "&p={{...}}" abgeschnitten, und
    // die Seite stand dann ohne Projekt (und damit ohne Adresse) da.
    const gesendet = await stub(page, { arten: [AUFMASS, MONTAGE] });
    await page.goto("/termin/m/Langner/1744/aufmass_vor_ort");

    // Terminart steht fest: keine Auswahl, direkt der Kalender.
    await expect(page.getByText("Montage vor Ort")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();

    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.staff).toBe("Langner");
    expect(abfrage.projectNr).toBe("1744");
    expect(abfrage.ruleSet).toBe("aufmass_vor_ort");

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByRole("button", { name: "Termin bestätigen" }).click();
    await expect(page.getByText("Termin steht")).toBeVisible();

    const buchung = gesendet.find((b) => b.action === "create");
    expect(buchung.projectNr).toBe("1744");
    expect(buchung.staff).toBe("Langner");
  });

  test("zusaetzliches Segment im Pfad: kein 404, Projekt bleibt erhalten", async ({ page }) => {
    // Die Links stehen in HERO-Mailvorlagen. Was ein Editor oder ein
    // Mailprogramm anhaengt, ist nicht vorhersehbar — es darf nur nicht im
    // 404 der App enden.
    const gesendet = await stub(page);
    await page.goto("/termin/m/Langner/1744/aufmass_vor_ort/noch_was");

    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.projectNr).toBe("1744");
    expect(abfrage.ruleSet).toBe("aufmass_vor_ort");
  });

  test("Projektnummer mit Praefix im Pfad: wird als Projekt erkannt", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto("/termin/m/Langner/WER-1744/aufmass_vor_ort");

    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.projectNr).toBe("WER-1744");
  });

  test("ungefuellter Platzhalter im Pfad: buchen geht trotzdem", async ({ page }) => {
    // Ersetzt HERO die Projektnummer nicht, steht die Klammer selbst im Link.
    // Sie darf nicht als Projektnummer mitgeschickt werden — der Server wiese
    // ab und der Kunde koennte nichts buchen.
    const gesendet = await stub(page);
    await page.goto("/termin/m/Langner/%7B%7BProjectMatch.display_id%7D%7D/aufmass_vor_ort");

    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.staff).toBe("Langner");
    expect(abfrage.projectNr).toBe(null);
  });

  test("Projekt im Link gibt es nicht: sagt es und laesst trotzdem buchen", async ({ page }) => {
    // Eine Projektnummer kann ins Leere zeigen (Projekt geloescht, Zahl
    // vertippt). Vorher war das ein 404 und der Kunde kam gar nicht weiter.
    const gesendet = await stub(page, { projektFehlt: true });
    await page.goto("/termin/m/Langner/1790/aufmass_vor_ort");

    await expect(page.getByText(/kein Projekt finden/)).toBeVisible();
    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByLabel("Name *").fill("Erika Muster");
    await page.getByLabel("E-Mail *").fill("erika@example.org");
    await page.getByRole("button", { name: "Termin bestätigen" }).click();
    await expect(page.getByText("Termin steht")).toBeVisible();

    const buchung = gesendet.find((b) => b.action === "create");
    expect(buchung.staff).toBe("Langner");
    expect(buchung.projectNr).toBe("1790");
  });

  test("Projektlink mit Mitarbeiter: schickt beides mit", async ({ page }) => {
    const gesendet = await stub(page);
    await page.goto(`/termin/${PROJEKT}?m=langner`);

    await expect(page.getByRole("button", { name: "09:00" })).toBeVisible();
    await expect(page.getByText(/Projekt WER-1234 · mit Langner/)).toBeVisible();

    const abfrage = gesendet.find((g) => g.action === "availability");
    expect(abfrage.staff).toBe("langner");
    expect(abfrage.project).toBe(PROJEKT);

    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByRole("button", { name: "Termin bestätigen" }).click();
    await expect(page.getByText("Termin steht")).toBeVisible();

    const buchung = gesendet.find((b) => b.action === "create");
    expect(buchung.staff).toBe("langner");
    expect(buchung.project).toBe(PROJEKT);
  });
});

test.describe("Dauer aus dem Link", () => {
  test("nimmt die Dauer aus dem Pfadsegment und zeigt die gerechnete Laenge", async ({ page }) => {
    // Vorlagenform: alles im Pfad, die Dauer als `d240` (das `d` unterscheidet
    // sie von der Projektnummer).
    const gesendet = await stub(page, { arten: [MONTAGE_WAEHLBAR], dauer: 240 });
    await page.goto("/termin/m/Langner/1916/montage_vor_ort/d240");

    await expect(page.getByRole("heading", { name: "Montage vor Ort" })).toBeVisible();
    await expect(page.getByText("4 Stunden")).toBeVisible();

    const verf = gesendet.find((g) => g.action === "availability");
    expect(verf.d).toBe("240");
    expect(verf.projectNr).toBe("1916");
    expect(verf.ruleSet).toBe("montage_vor_ort");
  });

  test("nimmt die Dauer auch aus der Query", async ({ page }) => {
    const gesendet = await stub(page, { arten: [MONTAGE_WAEHLBAR], dauer: 120 });
    await page.goto("/termin/m/langner?art=montage_vor_ort&d=120");

    await expect(page.getByText("2 Stunden")).toBeVisible();
    expect(gesendet.find((g) => g.action === "availability").d).toBe("120");
  });

  test("zeigt die Dauer des Servers, nicht die aus dem Link", async ({ page }) => {
    // Der Link will 5 Minuten, erlaubt sind mindestens 60 — der Server klemmt,
    // und auf der Seite muss stehen, was wirklich gilt.
    await stub(page, { arten: [MONTAGE_WAEHLBAR], dauer: 60 });
    await page.goto("/termin/m/langner?art=montage_vor_ort&d=5");
    await expect(page.getByText("1 Stunde")).toBeVisible();
  });

  test("schickt beim Buchen nur den Start, nicht das Ende", async ({ page }) => {
    // Das Ende rechnet der Server aus der Dauer. Wuerde die Seite es
    // mitschicken, liesse sich eine Achtstunden-Montage auf zehn Minuten
    // kuerzen.
    const gesendet = await stub(page, { arten: [MONTAGE_WAEHLBAR], dauer: 240 });
    await page.goto("/termin/m/langner?art=montage_vor_ort&d=240");
    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByLabel("Name *").fill("Erika Muster");
    await page.getByLabel("E-Mail *").fill("erika@example.org");
    await page.getByRole("button", { name: /Termin bestätigen|buchen/i }).click();

    // Erst auf die Bestaetigung warten: vorher ist die Buchung noch unterwegs.
    await expect(page.getByText("Termin steht")).toBeVisible();

    const create = gesendet.find((g) => g.action === "create");
    expect(create.slot.startsAt).toBeTruthy();
    expect(create.slot.endsAt).toBeUndefined();
    expect(create.d).toBe(240);
  });
});

test.describe("Terminorte ohne Anfahrt", () => {
  test("fragt beim Telefontermin nicht nach einer Adresse, aber nach der Nummer",
    async ({ page }) => {
      await stub(page, { arten: [TELEFON], dauer: 30 });
      await page.goto("/termin/m/langner?art=telefontermin");

      await expect(page.getByText("Telefontermin – wir rufen Sie an")).toBeVisible();
      // Kein Adressblock: wir fahren nicht hin.
      await expect(page.getByRole("button", { name: "Adresse ändern" })).toBeHidden();
      await expect(page.getByLabel("Straße und Nr.")).toBeHidden();

      await page.getByRole("button", { name: "09:00" }).click();
      await page.getByLabel("Name *").fill("Erika Muster");
      await page.getByLabel("E-Mail *").fill("erika@example.org");
      await expect(page.getByLabel("Telefon *")).toBeVisible();
      await page.getByRole("button", { name: /Termin bestätigen|buchen/i }).click();
      // Ohne Nummer weiss niemand, wen er anrufen soll.
      await expect(page.getByText("Für einen Telefontermin brauchen wir Ihre Rufnummer.")).toBeVisible();
    });

  test("nennt beim Buerotermin unsere Adresse", async ({ page }) => {
    await stub(page, { arten: [BUERO], dauer: 60 });
    await page.goto("/termin/m/langner?art=buerotermin");

    await expect(page.getByText("Bei uns im Büro, Otto-Hahn-Straße 3, 71364 Winnenden")).toBeVisible();
    await expect(page.getByRole("button", { name: "Adresse ändern" })).toBeHidden();
  });

  test("zeigt beim Onlinetermin nach dem Buchen den Videolink", async ({ page }) => {
    const url = "https://meet.jit.si/onlinetermin-0123456789abcdef";
    await stub(page, {
      arten: [ONLINE], dauer: 45, meetingUrl: url, treffpunkt: `Onlinetermin: ${url}`,
    });
    await page.goto("/termin/m/langner?art=onlinetermin");

    await expect(page.getByText("Onlinetermin – den Link bekommen Sie per E-Mail")).toBeVisible();
    await page.getByRole("button", { name: "09:00" }).click();
    await page.getByLabel("Name *").fill("Erika Muster");
    await page.getByLabel("E-Mail *").fill("erika@example.org");
    await page.getByRole("button", { name: /Termin bestätigen|buchen/i }).click();

    await expect(page.getByText("Termin steht")).toBeVisible();
    await expect(page.getByRole("link", { name: "Zum Videotermin" })).toHaveAttribute("href", url);
  });
});
