import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { takeInterruptedCamera } from "@/lib/cameraGuard";

// The start page redirects logged-in users on its own (to /projects or
// /admin), possibly after an async session check. For this long after start
// we keep steering back to the page the photo was taken from.
const HOLD_MS = 4000;
// Only these are automatic landing spots; if the user navigates anywhere
// else themselves in those seconds, we leave them alone.
const AUTO_LANDING = new Set(["/", "/projects", "/admin"]);

/**
 * Mounted once inside the router. If the phone restarted the app while the
 * camera was open (see cameraGuard.ts), bring the user back to the page they
 * took the photo from and tell them the photo has to be taken again.
 */
export function CameraInterruptNotice() {
  const navigate = useNavigate();
  const location = useLocation();
  const target = useRef<{ path: string; until: number } | null>(null);

  useEffect(() => {
    const interrupted = takeInterruptedCamera();
    if (!interrupted) return;
    target.current = { path: interrupted.path, until: Date.now() + HOLD_MS };
    toast.warning("Das Foto ist leider nicht angekommen", {
      description:
        "Das Handy hat die App beendet, während die Kamera offen war (meist, weil der Speicher knapp wurde). Bitte das Foto noch einmal aufnehmen. Hilft oft: andere Apps schließen.",
      duration: 15000,
    });
  }, []);

  useEffect(() => {
    const t = target.current;
    if (!t) return;
    if (Date.now() > t.until) { target.current = null; return; }
    if (location.pathname + location.search === t.path) return;
    if (AUTO_LANDING.has(location.pathname)) navigate(t.path, { replace: true });
    else target.current = null;
  }, [location.pathname, location.search, navigate]);

  return null;
}
