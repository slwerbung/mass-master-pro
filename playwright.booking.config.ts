import { defineConfig, devices } from "@playwright/test";

/**
 * Oberflaechen-Tests fuer die Terminbuchung.
 *
 * Bewusst getrennt von playwright.config.ts: die dortigen Tests laufen gegen
 * die Live-Seite, diese hier gegen den lokalen Build mit abgefangenen
 * API-Antworten. So lassen sie sich ohne Zugangsdaten und ohne echte Buchungen
 * ausfuehren — und sie pruefen genau das, was die Unit-Tests nicht koennen:
 * ob die Seite die Antworten auch richtig anzeigt.
 *
 *   npm run build && npx playwright test -c playwright.booking.config.ts
 */
export default defineConfig({
  testDir: "./tests/booking",
  fullyParallel: true,
  retries: 0,
  workers: 2,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // In Umgebungen mit vorinstalliertem Chromium (CI, Cloud-Sandbox) kann
      // der Pfad per PW_CHROMIUM gesetzt werden, statt einen zweiten Browser
      // herunterzuladen. Lokal bleibt alles beim Playwright-Standard.
      ...(process.env.PW_CHROMIUM
        ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } }
        : {}),
    },
  }],
  webServer: {
    command: "npx vite preview --port 4173 --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
