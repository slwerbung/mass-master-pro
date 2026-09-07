/**
 * Schalter fuer noch nicht abgenommene Funktionen.
 *
 * Der Leitsystem-Bereich haengt bewusst hinter einem Flag: laufende Projekte
 * sollen nichts davon mitbekommen, solange der Prototyp nicht abgenommen ist.
 *
 * Einschalten:  <app>/projects?leitsystem=1   (bleibt danach gesetzt)
 * Ausschalten:  <app>/projects?leitsystem=0
 */

const LEITSYSTEM_KEY = 'mmp_ff_leitsystem';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* Private-Mode o.ae. – dann bleibt das Flag eben aus. */
  }
}

/**
 * Liest `?leitsystem=1|0` aus der URL und merkt sich den Wert, damit der
 * Schalter per Link gesetzt werden kann, ohne dass es dafuer eine
 * Admin-Oberflaeche braucht.
 *
 * Liefert `true` zurueck, wenn sich der Schalter dadurch tatsaechlich
 * geaendert hat. Der Aufrufer laedt die Seite dann einmal neu: die
 * bestehenden Ansichten lesen das Flag beim Rendern, ein reines Umsetzen
 * im localStorage wuerde bei ihnen nicht ankommen.
 */
export function applyFeatureFlagsFromUrl(search: string): boolean {
  const params = new URLSearchParams(search);
  const value = params.get('leitsystem');
  if (value !== '1' && value !== '0') return false;
  const next = value === '1';
  if (readFlag(LEITSYSTEM_KEY) === next) return false;
  writeFlag(LEITSYSTEM_KEY, next);
  return true;
}

export function isLeitsystemEnabled(): boolean {
  return readFlag(LEITSYSTEM_KEY);
}

export function setLeitsystemEnabled(value: boolean): void {
  writeFlag(LEITSYSTEM_KEY, value);
}
