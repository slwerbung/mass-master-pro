import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { takeInterruptedCamera, diedAfterReturn, type CameraPending } from "@/lib/cameraGuard";
import { getCapture, clearCapture, resumePath } from "@/lib/captureSession";

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

// "/projects/abc/editor?x=1" → "/projects/abc"
function projectBase(path: string): string {
  const m = path.match(/^\/projects\/[^/?]+/);
  return m ? m[0] : "/projects";
}

interface Target {
  path: string;
  until: number;
  /** Also steer away from pages of this project (the restart landed there). */
  project?: string;
  /** Navigations left – never ping-pong with a route guard. */
  tries: number;
}

/**
 * Mounted once inside the router. On app start:
 *  - an unfinished new photo in the durable capture session (captureSession.ts)
 *    → go back to where it was left off (editor or location details) and say
 *    so, with the option to discard it;
 *  - otherwise, if the app was restarted during a camera round trip (see
 *    cameraGuard.ts) → bring the user back to the page they took the photo
 *    from and say the photo did not arrive.
 * An interrupted round trip is recorded either way.
 */
export function CameraInterruptNotice() {
  const navigate = useNavigate();
  const location = useLocation();
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    const startedAt = Date.now();
    const interrupted = takeInterruptedCamera();
    if (interrupted) report(interrupted);
    let cancelled = false;
    void getCapture().then((session) => {
      if (cancelled) return;
      if (session) {
        const base = projectBase(session.editorPath);
        setTarget({ path: resumePath(session), until: startedAt + HOLD_MS, project: base, tries: 2 });
        // Loading it keeps crashing the app: the editor gives up and says so.
        if (session.stage === "photo" && session.editorLoads >= 3) return;
        // The vehicle page saves a finished photo on its own right away.
        const autoSaves = session.stage === "edited" && /\/vehicle$/.test(session.nextPath ?? "");
        toast.success("Unfertiges Foto wiederhergestellt", {
          description: autoSaves
            ? "Das bemaßte Foto wird jetzt gespeichert."
            : session.stage === "edited"
              ? "Das bemaßte Foto ist noch da – du kannst den Standort jetzt speichern."
              : "Das Foto und alles, was du schon eingezeichnet hast, ist noch da.",
          duration: 12000,
          ...(autoSaves ? {} : {
            action: {
              label: "Verwerfen",
              onClick: () => { void clearCapture().then(() => navigate(base, { replace: true })); },
            },
          }),
        });
        return;
      }
      if (!interrupted) return;
      setTarget({ path: interrupted.path, until: startedAt + HOLD_MS, tries: 2 });
      toast.warning("Das Foto ist leider nicht angekommen", {
        description: diedAfterReturn(interrupted)
          ? "Die App ist beim Verarbeiten des Fotos neu gestartet. Bitte das Foto noch einmal aufnehmen – der Fehler wurde protokolliert."
          : "Das Handy hat die App beendet, während die Kamera offen war (meist, weil der Speicher knapp wurde). Bitte das Foto noch einmal aufnehmen. Hilft oft: andere Apps schließen.",
        duration: 15000,
      });
    });
    return () => { cancelled = true; };
    // Once per app start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = target;
    if (!t) return;
    const here = location.pathname + location.search;
    if (here === t.path) {
      // Arrived. From now on only undo automatic redirects (start page) –
      // the user moving on within the project (e.g. editor → details) is theirs.
      if (t.project) setTarget({ ...t, project: undefined });
      return;
    }
    if (Date.now() > t.until || t.tries <= 0) { setTarget(null); return; }
    const ours = AUTO_LANDING.has(location.pathname)
      || (!!t.project && (location.pathname === t.project || location.pathname.startsWith(t.project + "/")));
    if (!ours) { setTarget(null); return; }
    setTarget({ ...t, tries: t.tries - 1 });
    navigate(t.path, { replace: true });
  }, [target, location.pathname, location.search, navigate]);

  return null;
}
