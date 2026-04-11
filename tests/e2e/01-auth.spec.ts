/**
 * E2E-Tests: Authentifizierung
 * Testet Admin-Login (falsch + richtig), Mitarbeiter-Login, Kunden-Login, Logout
 */
import { test, expect } from '@playwright/test';
import {
  gotoLogin, fillAdminLogin, submitAdminForm,
  clearRateLimit, loginAsAdmin, loginAsEmployee, logout,
} from './helpers';

// ── Credentials aus Umgebungsvariablen ──────────────────────────────────────
const ADMIN_PW      = process.env.E2E_ADMIN_PASSWORD  ?? '';
const EMPLOYEE_NAME = process.env.E2E_EMPLOYEE_NAME   ?? '';
const EMPLOYEE_PW   = process.env.E2E_EMPLOYEE_PW     ?? '';
const CUSTOMER_NAME = process.env.E2E_CUSTOMER_NAME   ?? '';

// ════════════════════════════════════════════════════════════════════════════
// 1. Login-Startseite lädt korrekt
// ════════════════════════════════════════════════════════════════════════════
test('01 – Login-Seite zeigt Rollenauswahl', async ({ page }) => {
  await gotoLogin(page);
  await expect(page.getByText('Aufmaß-App')).toBeVisible();
  await expect(page.getByRole('button', { name: /Admin/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Mitarbeiter/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Kunde/i }).first()).toBeVisible();
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Admin-Login mit falschem Passwort + Rate Limiting
// ════════════════════════════════════════════════════════════════════════════
test('02 – Admin: falsches Passwort zeigt Fehlermeldung', async ({ page }) => {
  await gotoLogin(page);
  await clearRateLimit(page);
  await fillAdminLogin(page, 'falsch_1234_xyz');
  await submitAdminForm(page);

  // Toast-Fehlermeldung oder Inline-Fehler
  const error = page.locator('[data-sonner-toast], [role="alert"]').filter({ hasText: /falsch|Passwort|gesperrt|Fehler/i });
  await expect(error.first()).toBeVisible({ timeout: 10_000 });
  // Wir dürfen NICHT weitergeleitet werden
  await expect(page).not.toHaveURL(/\/admin/);
});

test('03 – Admin: Rate Limiting nach 5 Fehlversuchen (Lockout)', async ({ page }) => {
  await gotoLogin(page);
  // Rate-Limit-Counter auf 4 setzen (nächster Versuch = 5. = Lockout)
  await page.evaluate(() => {
    sessionStorage.setItem('mmp_login_attempts', JSON.stringify({ count: 4 }));
  });
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.getByLabel('Admin-Passwort').fill('definitiv_falsch');
  await page.getByRole('button', { name: /Anmelden/i }).click();

  // Lockout-Toast
  const lockoutToast = page.locator('[data-sonner-toast], [role="alert"]').filter({
    hasText: /gesperrt|Sekunden|warte/i,
  });
  await expect(lockoutToast.first()).toBeVisible({ timeout: 10_000 });

  // Input und Button müssen disabled sein
  await expect(page.getByLabel('Admin-Passwort')).toBeDisabled();
  await expect(page.getByRole('button', { name: /gesperrt/i })).toBeDisabled();

  // Countdown-Text im UI (mindestens ein Element mit "gesperrt" muss sichtbar sein)
  await expect(page.getByText(/gesperrt/i).first()).toBeVisible();
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Admin-Login mit richtigem Passwort
// ════════════════════════════════════════════════════════════════════════════
test('04 – Admin: Login mit richtigem Passwort', async ({ page }) => {
  test.skip(!ADMIN_PW, 'E2E_ADMIN_PASSWORD nicht gesetzt – Test übersprungen');

  await gotoLogin(page);
  await clearRateLimit(page);
  await loginAsAdmin(page, ADMIN_PW);

  await expect(page).toHaveURL(/\/admin/);
  // Admin-Dashboard-Elemente
  await expect(page.getByText(/Admin|Dashboard|Verwaltung/i).first()).toBeVisible();
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Mitarbeiter-Login
// ════════════════════════════════════════════════════════════════════════════
test('05 – Mitarbeiter-Login', async ({ page }) => {
  test.skip(!EMPLOYEE_NAME, 'E2E_EMPLOYEE_NAME nicht gesetzt – Test übersprungen');

  await gotoLogin(page);
  await clearRateLimit(page);
  await loginAsEmployee(page, EMPLOYEE_NAME, EMPLOYEE_PW);

  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByText(/Projekte|Meine Projekte/i).first()).toBeVisible();
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Kunden-Login
// ════════════════════════════════════════════════════════════════════════════
test('06 – Kunden-Login über Rollenauswahl', async ({ page }) => {
  test.skip(!CUSTOMER_NAME, 'E2E_CUSTOMER_NAME nicht gesetzt – Test übersprungen');

  await gotoLogin(page);
  await page.getByRole('button', { name: /Kunde/i }).first().click();
  await expect(page.getByLabel('Ihr Name')).toBeVisible({ timeout: 8_000 });
  await page.getByLabel('Ihr Name').fill(CUSTOMER_NAME);
  await page.getByRole('button', { name: /Weiter/i }).click();
  await page.waitForURL('**/customer', { timeout: 15_000 });
  await expect(page).toHaveURL(/\/customer/);
});

// ════════════════════════════════════════════════════════════════════════════
// 7. Logout – Session wird gelöscht, Redirect zu /
// ════════════════════════════════════════════════════════════════════════════
test('07 – Logout löscht Session und leitet zu / weiter', async ({ page }) => {
  test.skip(!ADMIN_PW, 'E2E_ADMIN_PASSWORD nicht gesetzt – Test übersprungen');

  // Einloggen
  await gotoLogin(page);
  await clearRateLimit(page);
  await loginAsAdmin(page, ADMIN_PW);
  await expect(page).toHaveURL(/\/admin/);

  // Logout via sessionStorage-Löschung (App-internes Logout)
  await logout(page);
  await expect(page).toHaveURL(/^\//);
  await expect(page.getByText('Aufmaß-App')).toBeVisible();

  // Nach Logout darf /admin nicht mehr erreichbar sein
  await page.goto('/admin');
  // Sollte zu / redirecten (RoleGuard)
  await expect(page).toHaveURL(/^https:\/\/mass-master-pro\.vercel\.app\/?$/, { timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. Kunden-Login mit falschem Namen
// ════════════════════════════════════════════════════════════════════════════
test('08 – Kunden-Login mit unbekanntem Namen zeigt Fehler', async ({ page }) => {
  await gotoLogin(page);
  await page.getByRole('button', { name: /Kunde/i }).first().click();
  await expect(page.getByLabel('Ihr Name')).toBeVisible({ timeout: 8_000 });
  await page.getByLabel('Ihr Name').fill('Xyzzy_Unbekannt_9999');
  await page.getByRole('button', { name: /Weiter/i }).click();

  const error = page.locator('[data-sonner-toast], [role="alert"]').filter({
    hasText: /nicht gefunden|Administrator/i,
  });
  await expect(error.first()).toBeVisible({ timeout: 8_000 });
  await expect(page).not.toHaveURL(/\/customer/);
});
