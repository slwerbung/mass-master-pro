import { heroProjectUrl } from "@/components/HeroLink";

/**
 * HERO lässt sich NICHT in die App einbetten: im Iframe einer fremden Domain sendet der Browser die HERO-Cookies nicht mit
 * (Login schlägt dort fehl, obwohl man angemeldet ist). Darum öffnet HERO in EINEM wiederverwendeten Popup-Fenster
 * (eigene Anmeldung, kein neuer Tab je Klick), die Karte in der App bleibt daneben stehen.
 */
const NAME = "hero-window";

function features() {
  const w = Math.min(1280, Math.round(screen.availWidth * 0.62));
  const h = Math.round(screen.availHeight * 0.92);
  return `popup=yes,width=${w},height=${h},left=${Math.max(0, screen.availWidth - w)},top=0`;
}

/** Fenster SOFORT im Klick öffnen (sonst blockiert der Browser es nach dem Warten auf den Server); Adresse folgt mit `showHero`. */
export function preopenHero(): Window | null {
  const w = window.open("about:blank", NAME, features());
  if (w) { try { w.opener = null; } catch { /* egal */ } }
  return w;
}

/** Fenster auf das Projekt setzen und nach vorn holen; ist es zu, wird es neu geöffnet. */
export function showHero(w: Window | null, heroId: number | string) {
  if (w && !w.closed) {
    try { w.location.href = heroProjectUrl(heroId); w.focus(); return; } catch { /* unten */ }
  }
  window.open(heroProjectUrl(heroId), NAME, features())?.focus();
}

/** Für Klick-Handler: HERO im Hero-Fenster öffnen (wiederverwendet). */
export function useHeroViewer() {
  return (heroId: number | string, _nr?: string | null) => showHero(null, heroId);
}
