import { useEffect, useState } from "react";

export type BlobUrlState = "idle" | "loading" | "ready" | "empty";

export interface BlobUrlResult {
  url: string | null;
  /**
   * `empty` heisst: nachgesehen, es gibt kein Bild. Das ist etwas anderes als
   * `loading` – ein Standort ohne Foto soll "Foto nachreichen" anzeigen und
   * nicht ewig einen Ladebalken.
   */
  state: BlobUrlState;
}

/**
 * Laedt ein Bild bei Bedarf aus IndexedDB und gibt eine Object-URL zurueck.
 *
 * Warum nicht einfach Base64: ein Base64-String liegt vollstaendig im
 * Arbeitsspeicher und ist obendrein ein Drittel groesser als die Datei. Bei
 * 300 Standorten sind das ueber ein Gigabyte. Eine Object-URL zeigt dagegen
 * nur auf den Blob, den der Browser selbst verwaltet.
 *
 * Die URL wird beim Aufraeumen wieder freigegeben – sonst haelt der Browser
 * den Blob bis zum Neuladen der Seite fest, und wir haetten das Problem nur
 * verschoben.
 */
export function useBlobUrl(
  load: (() => Promise<Blob | null>) | null,
  deps: unknown[],
  enabled = true,
): BlobUrlResult {
  const [result, setResult] = useState<BlobUrlResult>({ url: null, state: "idle" });

  useEffect(() => {
    if (!enabled || !load) {
      setResult({ url: null, state: "idle" });
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setResult({ url: null, state: "loading" });

    load()
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setResult({ url: null, state: "empty" });
          return;
        }
        created = URL.createObjectURL(blob);
        setResult({ url: created, state: "ready" });
      })
      .catch((error) => {
        console.warn("Bild konnte nicht geladen werden", error);
        if (!cancelled) setResult({ url: null, state: "empty" });
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return result;
}

/**
 * Meldet, sobald das Element in die Naehe des Sichtbereichs kommt.
 *
 * Bei 300 Standortkarten waere ein gleichzeitiges Laden aller Vorschauen
 * genauso lahm wie das frueher pauschale Base64-Laden. Der Vorlauf von 400 px
 * sorgt dafuer, dass beim Scrollen trotzdem nichts nachklappt.
 */
export function useNearViewport(ref: React.RefObject<Element>, rootMargin = "400px"): boolean {
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    if (isNear) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNear(true); // Aeltere Browser: dann eben sofort.
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, isNear]);

  return isNear;
}
