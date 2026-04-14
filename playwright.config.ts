import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E-Konfiguration für mass-master-pro
 * Target: https://mass-master-pro.vercel.app
 *
 * Credentials via Umgebungsvariablen (oder .env.test):
 *   E2E_ADMIN_PASSWORD   – Admin-Passwort
 *   E2E_EMPLOYEE_NAME    – Mitarbeitername (genau wie in DB)
 *   E2E_EMPLOYEE_PW      – Mitarbeiter-Passwort (leer lassen wenn keins gesetzt)
 *   E2E_CUSTOMER_NAME    – Kundenname (genau wie in DB)
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,        // sequentiell – Rate-Limit-Tests dürfen nicht interferieren
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'https://mass-master-pro.vercel.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
