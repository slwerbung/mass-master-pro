import { Page, expect } from '@playwright/test';

const BASE = 'https://mass-master-pro.vercel.app';

/** Navigiert zur Login-Seite und wartet bis sie geladen ist */
export async function gotoLogin(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Aufmaß-App')).toBeVisible({ timeout: 15_000 });
}

/** Klickt auf Admin und gibt das Passwort ein */
export async function fillAdminLogin(page: Page, password: string) {
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.getByLabel('Admin-Passwort').fill(password);
}

/** Submits das Admin-Formular */
export async function submitAdminForm(page: Page) {
  await page.getByRole('button', { name: /Anmelden/i }).click();
}

/** Setzt die Rate-Limit-Session auf 0 (über sessionStorage) */
export async function clearRateLimit(page: Page) {
  await page.evaluate(() => sessionStorage.removeItem('mmp_login_attempts'));
}

/** Loggt den Admin ein und wartet auf /admin */
export async function loginAsAdmin(page: Page, password: string) {
  await gotoLogin(page);
  await fillAdminLogin(page, password);
  await submitAdminForm(page);
  await page.waitForURL('**/admin', { timeout: 15_000 });
}

/** Loggt als Mitarbeiter ein (ohne Passwort-Pflicht) */
export async function loginAsEmployee(page: Page, employeeName: string, employeePw = '') {
  await gotoLogin(page);
  await page.getByRole('button', { name: /Mitarbeiter/i }).first().click();
  // Warte auf die Mitarbeiter-Liste
  await page.getByText('Mitarbeiter auswählen').waitFor({ timeout: 10_000 });
  // Wähle den Mitarbeiter anhand des Namens
  await page.getByRole('button', { name: new RegExp(employeeName, 'i') }).click();
  if (employeePw) {
    // Passwort-Dialog
    await page.getByLabel('Passwort').fill(employeePw);
    await page.getByRole('button', { name: /Anmelden/i }).click();
  }
  await page.waitForURL('**/projects', { timeout: 15_000 });
}

/** Logout: Löscht sessionStorage + localStorage und geht zurück zu / */
export async function logout(page: Page) {
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto('/');
  await expect(page.getByText('Aufmaß-App')).toBeVisible({ timeout: 10_000 });
}
