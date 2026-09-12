/**
 * Gemerkte Seitenverhaeltnisse der Standortbilder.
 *
 * Die Standortliste laedt ihre Bilder erst, wenn eine Karte in Sichtweite
 * kommt. Bis dahin stand dort ein Platzhalter von 180 px, waehrend das fertige
 * Foto 300 bis 500 px hoch ist. Jede Karte wuchs also in dem Moment, in dem
 * ihr Bild ankam – und weil das auch fuer die Karten unterhalb des
 * Sichtbereichs gilt, wurde die Seite beim Scrollen laufend laenger. Gemessen
 * bei nur vier Standorten: 620 px Zuwachs waehrend eines einzigen Wischens
 * nach unten. Man kam nicht ans Ende, weil das Ende vor einem weglief.
 *
 * Kennt die Karte das Seitenverhaeltnis vorher, reserviert sie sofort die
 * richtige Hoehe und nichts wandert mehr. Woher es kommt:
 *
 * 1. Beim Speichern eines Fotos wird es einmal gemessen und hier abgelegt.
 * 2. Sonst lernt es die Karte, sobald das Bild das erste Mal geladen ist.
 *
 * Der Speicher ist bewusst nur lokal (localStorage, wie der Bild-Hash-Cache).
 * Es ist eine Anzeige-Optimierung, kein Datenbestand: geht der Eintrag
 * verloren, sieht es einmal aus wie vorher und wird sofort neu gelernt.
 */

const STORAGE_KEY = "mmp_image_aspect_v1";
/**
 * Obergrenze, damit der Eintrag nicht ueber Jahre mitwaechst. Beim Ueberlauf
 * wird die aeltere Haelfte verworfen – die betroffenen Bilder lernen ihr
 * Verhaeltnis beim naechsten Ansehen einfach neu.
 */
const MAX_ENTRIES = 4000;

/**
 * Annahme fuer ein noch unbekanntes Foto: 4:3 im Querformat. Das ist das
 * Format, in dem die Kamera der App aufnimmt. Ein Hochformat-Foto wandert
 * damit beim ersten Ansehen noch einmal – danach steht es.
 */
export const DEFAULT_PHOTO_ASPECT = 4 / 3;

type Cache = Record<string, number>;

let memory: Cache | null = null;

function load(): Cache {
  if (memory) return memory;
  memory = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "number" && isUsable(value)) memory[key] = value;
        }
      }
    }
  } catch {
    // Kaputter oder gesperrter Speicher (privates Fenster): dann eben ohne.
  }
  return memory;
}

let writePending = false;
function scheduleWrite() {
  if (writePending) return;
  writePending = true;
  // Gesammelt schreiben: beim Scrollen durch 200 Standorte waeren das sonst
  // 200 einzelne, synchrone localStorage-Schreibvorgaenge.
  setTimeout(() => {
    writePending = false;
    const cache = load();
    try {
      const keys = Object.keys(cache);
      if (keys.length > MAX_ENTRIES) {
        for (const key of keys.slice(0, keys.length - MAX_ENTRIES / 2)) delete cache[key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // Voll oder gesperrt – der Speicher im Arbeitsspeicher reicht fuer diese Sitzung.
    }
  }, 500);
}

/** Unsinnige Werte draussen halten: 0, NaN, Unendlich, absurde Streifen. */
function isUsable(aspect: number): boolean {
  return Number.isFinite(aspect) && aspect > 0.05 && aspect < 20;
}

/** Das gemerkte Verhaeltnis Breite/Hoehe, oder `null`. */
export function knownAspect(id: string): number | null {
  const value = load()[id];
  return typeof value === "number" && isUsable(value) ? value : null;
}

/** Verhaeltnis merken. Ungueltige Masse werden stillschweigend verworfen. */
export function rememberAspect(id: string, width: number, height: number): void {
  if (!id || !width || !height) return;
  const aspect = width / height;
  if (!isUsable(aspect)) return;
  const cache = load();
  const rounded = Math.round(aspect * 10000) / 10000;
  if (cache[id] === rounded) return;
  cache[id] = rounded;
  scheduleWrite();
}

/**
 * Ein frisch gespeichertes Foto einmal vermessen, damit die Liste es nie
 * unvorbereitet antrifft. Laeuft nebenher und wirft nie – schlaegt es fehl,
 * lernt die Karte das Verhaeltnis eben spaeter selbst.
 */
export function rememberAspectFromDataUrl(id: string, dataUrl: string | null | undefined): void {
  if (!id || !dataUrl || typeof Image === "undefined") return;
  try {
    const image = new Image();
    image.onload = () => rememberAspect(id, image.naturalWidth, image.naturalHeight);
    image.onerror = () => { /* kein Drama, wird spaeter gelernt */ };
    image.src = dataUrl;
  } catch {
    // ebenfalls kein Drama
  }
}
