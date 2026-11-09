import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
// @ts-ignore - QueryClient export may not resolve during partial installs
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";
import SlugRoute from "@/components/SlugRoute";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getSession, clearSession, getRememberedLogin, renewEmployeeSession, sessionNeedsRenewal } from "@/lib/session";
import { toast } from "sonner";
import { syncAllToSupabase } from "@/lib/supabaseSync";
import { startHeroUploadWorker } from "@/lib/heroUploadWorker";
import { supabase } from "@/integrations/supabase/client";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import Camera from "./pages/Camera";
import PhotoEditor from "./pages/PhotoEditor";
import LocationDetails from "./pages/LocationDetails";
import Export from "./pages/Export";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import CustomerView from "./pages/CustomerView";
import CustomerLogin from "./pages/CustomerLogin";
import FloorPlanUpload from "./pages/FloorPlanUpload";
import FloorPlanView from "./pages/FloorPlanView";
import GuestAccess from "./pages/GuestAccess";
import GuestProject from "./pages/GuestProject";
import VehicleDetail from "./pages/VehicleDetail";
import NewCustomerSignup from "./pages/NewCustomerSignup";
import VehicleInquiry from "./pages/VehicleInquiry";
import CamperRepairInquiry from "./pages/CamperRepairInquiry";
import LayoutUpload from "./pages/LayoutUpload";
import Gestaltung from "./pages/Gestaltung";
import HeroOfferAction from "./pages/HeroOfferAction";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import LabelPrint from "./pages/LabelPrint";
import Protokoll from "./pages/Protokoll";
import NotFound from "./pages/NotFound";
import { MeetingRecorderProvider } from "@/components/MeetingRecorder";
import { CameraInterruptNotice } from "@/components/CameraInterruptNotice";

// Interner Probo-Katalog-Generator: bewusst lazy, damit @react-pdf/renderer
// nicht im Haupt-Bundle landet, das alle Mitarbeiter laden.
const ProboCatalog = lazy(() => import("./pages/ProboCatalog"));

// Terminbuchung: oeffentliche Seiten, die nur Kunden ueber einen Link
// erreichen. Lazy, damit react-day-picker und luxon nicht im Haupt-Bundle
// liegen, das jeder Mitarbeiter bei jedem Start laedt.
const BookingPage = lazy(() => import("./pages/BookingPage"));
const BookingCancel = lazy(() => import("./pages/BookingCancel"));
const BookingStaffAction = lazy(() => import("./pages/BookingStaffAction"));

function BookingSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
          wird geladen...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

const queryClient = new QueryClient();

const SESSION_CACHE_KEY = "session_validation_cache";
const SESSION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedValidation(role: string, token: string, userId: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const key = `${role}:${token}:${userId}`;
    if (cache.key === key && Date.now() - cache.ts < SESSION_CACHE_TTL) {
      return cache.valid;
    }
  } catch {}
  return null;
}

function setCachedValidation(role: string, token: string, userId: string, valid: boolean) {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      key: `${role}:${token}:${userId}`,
      ts: Date.now(),
      valid,
    }));
  } catch {}
}

// "Angemeldet bleiben": Ist das App-Token abgelaufen, der Mitarbeiter wollte
// aber angemeldet bleiben, erst still erneuern – sonst landete jeder direkt
// geoeffnete Projektlink nach 12 h auf dem Login.
const RoleGuard = ({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) => {
  const [renewing, setRenewing] = useState(
    () => !getSession() && !!getRememberedLogin() && allowedRoles.includes("employee"),
  );
  useEffect(() => {
    if (!renewing) return;
    let mounted = true;
    renewEmployeeSession().finally(() => { if (mounted) setRenewing(false); });
    return () => { mounted = false; };
  }, [renewing]);
  if (renewing) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Sitzung wird geprüft...</div>;
  return <RoleGuardInner allowedRoles={allowedRoles}>{children}</RoleGuardInner>;
};

/** Erneuert das Token eines gemerkten Mitarbeiters rechtzeitig vor Ablauf. */
function SessionKeeper() {
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (getSession() && sessionNeedsRenewal()) void renewEmployeeSession();
    };
    check();
    const timer = window.setInterval(check, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);
  return null;
}

const RoleGuardInner = ({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) => {
  const session = getSession();

  // Compute initial validation state synchronously to avoid flash of "Sitzung wird geprüft..."
  const getInitialState = (): boolean | null => {
    if (!session) return false;
    if (!allowedRoles.includes(session.role)) return false;
    // Guest customers have no authToken (they use a separate guest_token in
    // localStorage for their direct-project access) – allow them through.
    if (session.role === "customer" && !session.authToken) return true;
    if (!session.authToken) return true;
    // Try cache synchronously – avoids spinner on every navigation
    const cached = getCachedValidation(session.role, session.authToken, session.id);
    return cached; // null = cache miss, needs async validation
  };

  const [validated, setValidated] = useState<boolean | null>(getInitialState);

  // Betriebsdaten sind nur noch mit echter Supabase-Session lesbar. Fehlt sie
  // – etwa weil der Browser noch eine aeltere, gecachte App-Version geladen
  // hatte, die den neuen Login-Weg nicht kennt – waere die Ansicht einfach
  // leer. Dann lieber sauber zurueck zum Login mit klarer Ansage.
  // Admin ist ausgenommen: dieser Zugang laeuft weiterhin rein ueber Passwort
  // und Edge Functions, ohne Supabase-Konto.
  const [supabaseSessionMissing, setSupabaseSessionMissing] = useState(false);
  useEffect(() => {
    if (!session || (session.role !== "employee" && session.role !== "customer")) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted || data.session) return;
      clearSession();
      toast.error("Bitte einmal neu anmelden – die Sitzung ist nicht mehr vollständig.");
      setSupabaseSessionMissing(true);
    });
    return () => { mounted = false; };
  }, [session?.role, session?.id]);

  useEffect(() => {
    // Only run async validation if cache missed (validated === null)
    if (validated !== null) return;
    if (!session?.authToken) { setValidated(true); return; }

    let mounted = true;
    supabase.functions.invoke("validate-session", {
      body: { role: session.role, token: session.authToken, userId: session.id },
    }).then(({ data, error }) => {
      if (!mounted) return;
      // Intentional offline-tolerant fallback: if the Edge Function call
      // itself fails (network error, Supabase cold-start) we let the user
      // through rather than force a logout. The token's signature and expiry
      // are already verified client-side in session.ts (getSession). Trade-off:
      // a revoked/expired token is not rejected during outages.
      const isValid = error ? true : !!data?.valid;
      setCachedValidation(session.role, session.authToken!, session.id, isValid);
      setValidated(isValid);
    });
    return () => { mounted = false; };
  }, [validated, session?.role, session?.authToken, session?.id]);

  if (supabaseSessionMissing) return <Navigate to="/" replace />;
  if (validated === null) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Sitzung wird geprüft...</div>;
  if (!validated) {
    // Preserve the path + search the user was trying to reach so we can
    // redirect them back after login. Without this, somebody clicking a
    // direct project link in a notification email lands on /auth, logs
    // in, and ends up on /projects (the list) - having lost the link.
    const target = window.location.pathname + window.location.search;
    const isHome = target === "/" || target === "/auth";
    const next = isHome ? "" : `?next=${encodeURIComponent(target)}`;
    return <Navigate to={`/${next}`} replace />;
  }
  return <>{children}</>;
};

const App = () => {
  // When coming back online, sync all pending local changes to Supabase
  useEffect(() => {
    const handleOnline = () => {
      if (getSession()) syncAllToSupabase();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // Background worker that drains the HERO upload queue. Starts once on
  // app mount; if the queue has no items it idles cheaply.
  useEffect(() => {
    startHeroUploadWorker();
  }, []);

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SessionKeeper />
        {/* Brings the user back if the phone restarted the app while the camera was open. */}
        <CameraInterruptNotice />
        <MeetingRecorderProvider>
        <Routes>
          <Route path="/" element={<Auth />} />
          <Route path="/admin" element={<RoleGuard allowedRoles={["admin"]}><Admin /></RoleGuard>} />
          <Route path="/projects" element={<RoleGuard allowedRoles={["admin", "employee"]}><Projects /></RoleGuard>} />
          <Route path="/projects/new" element={<RoleGuard allowedRoles={["admin", "employee"]}><NewProject /></RoleGuard>} />
          <Route path="/etiketten" element={<RoleGuard allowedRoles={["admin", "employee"]}><LabelPrint /></RoleGuard>} />
          <Route path="/protokoll" element={<RoleGuard allowedRoles={["admin", "employee"]}><Protokoll /></RoleGuard>} />
          <Route path="/projects/:projectId" element={<RoleGuard allowedRoles={["admin", "employee"]}><ProjectDetail /></RoleGuard>} />
          <Route path="/projects/:projectId/camera" element={<RoleGuard allowedRoles={["admin", "employee"]}><Camera /></RoleGuard>} />
          <Route path="/projects/:projectId/editor" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/location-details" element={<RoleGuard allowedRoles={["admin", "employee"]}><LocationDetails /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/edit" element={<RoleGuard allowedRoles={["admin", "employee"]}><LocationDetails /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit" element={<RoleGuard allowedRoles={["admin", "employee"]}><LocationDetails /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/edit-image" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit-image" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/vehicle/measured/:measuredId/edit-image" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/export" element={<RoleGuard allowedRoles={["admin", "employee"]}><Export /></RoleGuard>} />
          <Route path="/projects/:projectId/floor-plans" element={<RoleGuard allowedRoles={["admin", "employee"]}><FloorPlanView /></RoleGuard>} />
          <Route path="/projects/:projectId/vehicle" element={<RoleGuard allowedRoles={["admin", "employee"]}><VehicleDetail /></RoleGuard>} />
          <Route path="/projects/:projectId/floor-plans/upload" element={<RoleGuard allowedRoles={["admin", "employee"]}><FloorPlanUpload /></RoleGuard>} />
          {/* Customer routes - /kunde is public login, /customer is protected */}
          <Route path="/kunde" element={<CustomerLogin />} />
          <Route path="/customer" element={<RoleGuard allowedRoles={["customer"]}><CustomerView /></RoleGuard>} />
          <Route path="/guest/:projectId" element={<GuestAccess />} />
          <Route path="/guest/:projectId/view" element={<GuestProject />} />
          {/* Public new-customer signup form */}
          <Route path="/neukunde" element={<NewCustomerSignup />} />
          <Route path="/fahrzeug-anfrage" element={<VehicleInquiry />} />
          <Route path="/wohnmobil-reparatur" element={<CamperRepairInquiry />} />
          <Route path="/layout-upload" element={<LayoutUpload />} />
          <Route path="/gestaltung" element={<Gestaltung />} />
          <Route path="/hero-aktion" element={<HeroOfferAction />} />
          <Route path="/datenschutz" element={<PrivacyPolicy />} />
          {/* Terminbuchung. Der Link ist der Zugang: die Edge Function
              rechnet serverseitig und der Token haengt am einzelnen Termin. */}
          {/* Dauerlink eines Mitarbeiters, ohne Projektbezug. Kollidiert nicht
              mit /termin/:projectId: React Router bewertet das feste "m"
              hoeher als ein Platzhalter (wie bei absagen/ und intern/). */}
          {/* Bewusst ein Sternchen: Mitarbeiter, Projektnummer und Terminart
              stehen bei Links aus HERO-Mailvorlagen im PFAD (der Vorlagen-
              Editor schnitt Query-Parameter mit Platzhaltern ab). Welche
              Segmente in welcher Zahl kommen, entscheidet dann die Seite —
              feste Routen liessen jede unerwartete Form im 404 landen. */}
          <Route path="/termin/m/*" element={<BookingSuspense><BookingPage /></BookingSuspense>} />
          <Route path="/termin/:projectId" element={<BookingSuspense><BookingPage /></BookingSuspense>} />
          <Route path="/termin/absagen/:token" element={<BookingSuspense><BookingCancel /></BookingSuspense>} />
          <Route path="/termin/intern/:token" element={<BookingSuspense><BookingStaffAction /></BookingSuspense>} />
          {/* Kundenlinks mit Firmennamen (Spec B): /<firma>/… – alle alten Pfade bleiben. SlugRoute leitet einen
              falschen Firmennamen auf den eingestellten um. Neue Präfixe auch in vite.config.ts navigateFallbackDenylist. */}
          <Route path="/freigabe/:projectId" element={<GuestAccess />} />
          <Route path="/:firma/freigabe/:projectId" element={<SlugRoute><GuestAccess /></SlugRoute>} />
          <Route path="/:firma/freigabe/:projectId/ansehen" element={<SlugRoute><GuestProject /></SlugRoute>} />
          <Route path="/:firma/kunde" element={<SlugRoute><CustomerLogin /></SlugRoute>} />
          <Route path="/:firma/termin/m/*" element={<SlugRoute><BookingSuspense><BookingPage /></BookingSuspense></SlugRoute>} />
          <Route path="/:firma/termin/absagen/:token" element={<SlugRoute><BookingSuspense><BookingCancel /></BookingSuspense></SlugRoute>} />
          <Route path="/:firma/termin/intern/:token" element={<SlugRoute><BookingSuspense><BookingStaffAction /></BookingSuspense></SlugRoute>} />
          <Route path="/:firma/termin/:projectId" element={<SlugRoute><BookingSuspense><BookingPage /></BookingSuspense></SlugRoute>} />
          <Route path="/:firma/hero-aktion" element={<SlugRoute><HeroOfferAction /></SlugRoute>} />
          <Route path="/:firma/neukunde" element={<SlugRoute><NewCustomerSignup /></SlugRoute>} />
          <Route path="/:firma/fahrzeug-anfrage" element={<SlugRoute><VehicleInquiry /></SlugRoute>} />
          <Route path="/:firma/wohnmobil-reparatur" element={<SlugRoute><CamperRepairInquiry /></SlugRoute>} />
          <Route path="/:firma/layout-upload" element={<SlugRoute><LayoutUpload /></SlugRoute>} />
          <Route path="/:firma/gestaltung" element={<SlugRoute><Gestaltung /></SlugRoute>} />
          <Route path="/:firma/datenschutz" element={<SlugRoute><PrivacyPolicy /></SlugRoute>} />
          {/* Internes Werkzeug: absichtlich nirgends verlinkt. Der Pfad steht
              zwar im JS-Bundle, aber Seite und Edge Function verlangen eine
              gueltige Mitarbeiter-/Admin-Sitzung. */}
          <Route
            path="/probo-katalog"
            element={
              <RoleGuard allowedRoles={["admin", "employee"]}>
                <Suspense
                  fallback={
                    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
                      Katalog wird geladen...
                    </div>
                  }
                >
                  <ProboCatalog />
                </Suspense>
              </RoleGuard>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </MeetingRecorderProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
