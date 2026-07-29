// Signierte Links fuer eine Liste von Storage-Pfaden.
//
// Gedacht fuer Ansichten, die Bilder direkt rendern: das <img src> braucht den
// Link synchron, das Signieren ist aber asynchron. Der Hook loest die Pfade im
// Hintergrund auf und gibt eine Zuordnung Pfad -> Link zurueck; solange ein
// Link fehlt, liefert der Getter einen leeren String.

import { useCallback, useEffect, useRef, useState } from "react";
import { signedFileUrls } from "@/lib/storageUrl";

export function useSignedUrls(paths: (string | null | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Bereits angefragte Pfade: verhindert, dass jeder Render erneut signiert.
  const requested = useRef<Set<string>>(new Set());

  const key = paths.filter(Boolean).join("|");

  useEffect(() => {
    const wanted = (paths.filter(Boolean) as string[]).filter((p) => !requested.current.has(p));
    if (wanted.length === 0) return;
    wanted.forEach((p) => requested.current.add(p));

    let mounted = true;
    signedFileUrls(wanted).then((resolved) => {
      if (!mounted || Object.keys(resolved).length === 0) return;
      setUrls((prev) => ({ ...prev, ...resolved }));
      // Pfade ohne Link erneut zulassen — direkt nach dem Anmelden kann der
      // erste Versuch ins Leere laufen, bevor die Session im Storage-Client steht.
      wanted.forEach((p) => { if (!resolved[p]) requested.current.delete(p); });
    });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const urlFor = useCallback((path?: string | null) => (path && urls[path]) || "", [urls]);

  return { urls, urlFor };
}
