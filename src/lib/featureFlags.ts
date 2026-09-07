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
 * Liest `?leitsystem=1|0` aus der URL und merkt sich den Wert. Wird einmal
 * beim App-Start aufgerufen, damit der Schalter ueber einen Link gesetzt
 * werden kann, ohne dass es dafuer eine Admin-Oberflaeche braucht.
 */
export function applyFeatureFlagsFromUrl(search: string): void {
  const params = new URLSearchParams(search);
  const value = params.get('leitsystem');
  if (value === '1') writeFlag(LEITSYSTEM_KEY, true);
  else if (value === '0') writeFlag(LEITSYSTEM_KEY, false);
}

export function isLeitsystemEnabled(): boolean {
  return readFlag(LEITSYSTEM_KEY);
}

export function setLeitsystemEnabled(value: boolean): void {
  writeFlag(LEITSYSTEM_KEY, value);
}
