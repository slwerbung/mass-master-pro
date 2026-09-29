import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { takeInterruptedCamera, diedAfterReturn, type CameraPending } from "@/lib/cameraGuard";

// The start page redirects logged-in users on its own (to /projects or
// /admin), possibly after an async session check. For this long after start
// we keep steering back to the page the photo was taken from.
const HOLD_MS = 4000;
// Only these are automatic landing spots; if the user navigates anywhere
// else themselves in those seconds, we leave them alone.
const AUTO_LANDING = new Set(["/", "/projects", "/admin"]);

// Best effort: staff devices have a Supabase session and may write
// public.client_diagnostics. Without one (admin login) the insert is refused
// and simply ignored – the notice itself still works.
function report(p: CameraPending) {
  const payload = {
    stage: p.stage,
    flow: p.flow,
    path: p.path,
    msInStage: p.stageAt - p.at,
    msUntilRestart: Date.now() - p.at,
    ...p.info,
  };
  try {
    localStorage.setItem("camera-last-incident", JSON.stringify({ at: new Date().toISOString(), ...payload }));
  } catch { /* ignore */ }
  void (supabase as any)
    .from("client_diagnostics")
    .insert({ kind: "camera_restart", payload, user_agent: navigator.userAgent.slice(0, 400) })
    .then(() => {}, () => {});
}

/**
 * Mounted once inside the router. If the app was restarted during a camera
 * round trip (see cameraGuard.ts), bring the user back to the page they took
 * the photo from, say what happened and record where it broke off.
 */
export function CameraInterruptNotice() {
  const navigate = useNavigate();
  const location = useLocation();
  const target = useRef<{ path: string; until: number } | null>(null);

  useEffect(() => {
    const interrupted = takeInterruptedCamera();
    if (!interrupted) return;
    target.current = { path: interrupted.path, until: Date.now() + HOLD_MS };
    report(interrupted);
    toast.warning("Das Foto ist leider nicht angekommen", {
      description: diedAfterReturn(interrupted)
        ? "Die App ist beim Verarbeiten des Fotos neu gestartet. Bitte das Foto noch einmal aufnehmen – der Fehler wurde protokolliert."
        : "Das Handy hat die App beendet, während die Kamera offen war (meist, weil der Speicher knapp wurde). Bitte das Foto noch einmal aufnehmen. Hilft oft: andere Apps schließen.",
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
