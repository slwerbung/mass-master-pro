import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
// @ts-ignore - QueryClient export may not resolve during partial installs
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getSession, clearSession } from "@/lib/session";
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
import CustomerManage from "./pages/CustomerManage";
import CustomerLogin from "./pages/CustomerLogin";
import FloorPlanUpload from "./pages/FloorPlanUpload";
import FloorPlanView from "./pages/FloorPlanView";
import GuestAccess from "./pages/GuestAccess";
import GuestProject from "./pages/GuestProject";
import VehicleDetail from "./pages/VehicleDetail";
import NewCustomerSignup from "./pages/NewCustomerSignup";
import VehicleInquiry from "./pages/VehicleInquiry";
import LayoutUpload from "./pages/LayoutUpload";
import Gestaltung from "./pages/Gestaltung";
import HeroOfferAction from "./pages/HeroOfferAction";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import LabelPrint from "./pages/LabelPrint";
import Protokoll from "./pages/Protokoll";
import NotFound from "./pages/NotFound";
import { MeetingRecorderProvider } from "@/components/MeetingRecorder";

// Interner Probo-Katalog-Generator: bewusst lazy, damit @react-pdf/renderer
// nicht im Haupt-Bundle landet, das alle Mitarbeiter laden.
const ProboCatalog = lazy(() => import("./pages/ProboCatalog"));

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

const RoleGuard = ({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) => {
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
        <MeetingRecorderProvider>
        <Routes>
          <Route path="/" element={<Auth />} />
          <Route path="/admin" element={<RoleGuard allowedRoles={["admin"]}><Admin /></RoleGuard>} />
          <Route path="/projects" element={<RoleGuard allowedRoles={["admin", "employee"]}><Projects /></RoleGuard>} />
          <Route path="/projects/new" element={<RoleGuard allowedRoles={["admin", "employee"]}><NewProject /></RoleGuard>} />
          <Route path="/projects/customers" element={<RoleGuard allowedRoles={["admin", "employee"]}><CustomerManage /></RoleGuard>} />
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
          <Route path="/layout-upload" element={<LayoutUpload />} />
          <Route path="/gestaltung" element={<Gestaltung />} />
          <Route path="/hero-aktion" element={<HeroOfferAction />} />
          <Route path="/datenschutz" element={<PrivacyPolicy />} />
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
