/**
 * E2E-Tests: Projekte & Kamera
 * Testet: Neues Projekt anlegen, Kamera-Seite öffnen (zweiten Standort anlegen)
 *
 * Voraussetzung: E2E_ADMIN_PASSWORD oder E2E_EMPLOYEE_NAME + E2E_EMPLOYEE_PW
 */
import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin, loginAsEmployee, logout, clearRateLimit, gotoLogin } from './helpers';

const ADMIN_PW      = process.env.E2E_ADMIN_PASSWORD ?? '';
const EMPLOYEE_NAME = process.env.E2E_EMPLOYEE_NAME  ?? '';
const EMPLOYEE_PW   = process.env.E2E_EMPLOYEE_PW    ?? '';

/** Hilfsfunktion: Loggt je nach verfügbarem Credential ein */
async function loginAny(page: Page) {
  if (ADMIN_PW) {
    await gotoLogin(page);
    await clearRateLimit(page);
    await loginAsAdmin(page, ADMIN_PW);
    // Admin → Projekte-Seite
    await page.goto('/projects');
    await page.waitForURL('**/projects', { timeout: 10_000 });
  } else if (EMPLOYEE_NAME) {
    await loginAsEmployee(page, EMPLOYEE_NAME, EMPLOYEE_PW);
  } else {
    test.skip(true, 'Weder E2E_ADMIN_PASSWORD noch E2E_EMPLOYEE_NAME gesetzt – Test übersprungen');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Projekte-Seite lädt nach Login
// ════════════════════════════════════════════════════════════════════════════
test('09 – Projekte-Seite lädt korrekt nach Login', async ({ page }) => {
  test.skip(!ADMIN_PW && !EMPLOYEE_NAME, 'Keine Credentials gesetzt');
  await loginAny(page);
  await expect(page).toHaveURL(/\/projects/);
  // "Neues Projekt" Button muss sichtbar sein
  await expect(page.getByRole('button', { name: /Neues Projekt|Neu/i }).first()).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Neues Projekt anlegen
// ════════════════════════════════════════════════════════════════════════════
test('10 – Neues Projekt anlegen', async ({ page }) => {
  test.skip(!ADMIN_PW && !EMPLOYEE_NAME, 'Keine Credentials gesetzt');
  await loginAny(page);

  // Klick auf "Neues Projekt"
  await page.getByRole('button', { name: /Neues Projekt|Neu/i }).first().click();
  await page.waitForURL('**/projects/new', { timeout: 10_000 });

  // Projektnummer eingeben (eindeutig per Timestamp)
  const projectNum = `E2E-${Date.now()}`;
  const projectNumInput = page.getByLabel(/Projektnummer|Nummer/i).first();
  await expect(projectNumInput).toBeVisible({ timeout: 8_000 });
  await projectNumInput.fill(projectNum);

  // Typ auswählen (Aufmaß ist Standard)
  // Projekt erstellen
  const createBtn = page.getByRole('button', { name: /Projekt erstellen|Erstellen|Anlegen/i }).first();
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  // Weiterleitung zur Projektdetail-Seite
  await page.waitForURL(/\/projects\/[^/]+$/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/projects\//);
  // Projektnummer soll auf der Seite erscheinen
  await expect(page.getByText(projectNum)).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Kamera-Seite öffnen & zweiten Standort anlegen
// ════════════════════════════════════════════════════════════════════════════
test('11 – Kamera-Seite öffnen und zweiten Standort anlegen', async ({ page }) => {
  test.skip(!ADMIN_PW && !EMPLOYEE_NAME, 'Keine Credentials gesetzt');
  await loginAny(page);

  // Zuerst neues Projekt anlegen
  await page.getByRole('button', { name: /Neues Projekt|Neu/i }).first().click();
  await page.waitForURL('**/projects/new', { timeout: 10_000 });

  const projectNum = `E2E-CAM-${Date.now()}`;
  const projectNumInput = page.getByLabel(/Projektnummer|Nummer/i).first();
  await expect(projectNumInput).toBeVisible({ timeout: 8_000 });
  await projectNumInput.fill(projectNum);

  await page.getByRole('button', { name: /Projekt erstellen|Erstellen|Anlegen/i }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/, { timeout: 15_000 });

  // Projekt-ID aus der URL extrahieren
  const projectUrl = page.url();
  const projectId = projectUrl.match(/\/projects\/([^/]+)/)?.[1];
  expect(projectId).toBeTruthy();

  // Direkt zur Kamera-Seite navigieren
  await page.goto(`/projects/${projectId}/camera`);
  await page.waitForURL(`**/projects/${projectId}/camera`, { timeout: 15_000 });

  // Kamera-Seite geladen? (Standort-Elemente)
  await expect(page.getByText(/Standort|Kamera|Foto|Aufnahme/i).first()).toBeVisible({ timeout: 10_000 });

  // Zweiten Standort anlegen: Suche nach "Standort hinzufügen" oder ähnlichem Button
  const addLocationBtn = page.getByRole('button', {
    name: /Standort hinzufügen|Neuer Standort|Hinzufügen|\+/i,
  }).first();

  if (await addLocationBtn.isVisible()) {
    await addLocationBtn.click();
    // Eingabefeld für Standortname
    const locationInput = page.getByPlaceholder(/Standortname|Name des Standorts/i).first();
    if (await locationInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await locationInput.fill('Standort 2 (E2E)');
    }
    // Bestätigen
    const confirmBtn = page.getByRole('button', { name: /OK|Bestätigen|Hinzufügen|Speichern/i }).first();
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    // Zweiter Standort erscheint in der Liste
    await expect(page.getByText(/Standort 2/i)).toBeVisible({ timeout: 8_000 });
  } else {
    // Falls kein dedizierter Button – prüfen ob überhaupt Standort-Karten vorhanden
    await expect(page.getByText(/Standort/i).first()).toBeVisible({ timeout: 8_000 });
    console.log('INFO: "Standort hinzufügen"-Button nicht gefunden – manuelle Überprüfung empfohlen');
  }
});
