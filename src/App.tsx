import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
// @ts-ignore - QueryClient export may not resolve during partial installs
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getSession } from "@/lib/session";
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
import NotFound from "./pages/NotFound";

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

  const getInitialState = (): boolean | null => {
    if (!session) return false;
    if (!allowedRoles.includes(session.role)) return false;
    if (session.role === "customer") return true;
    if (!session.authToken) return true;
    return getCachedValidation(session.role, session.authToken, session.id); // null = cache miss
  };

  const [validated, setValidated] = useState<boolean | null>(getInitialState);

  useEffect(() => {
    if (validated !== null) return; // cache hit – kein Netzwerkaufruf nötig
    let mounted = true;
    const run = async () => {
      const { data, error } = await supabase.functions.invoke("validate-session", {
        body: { role: session!.role, token: session!.authToken, userId: session!.id },
      });
      if (mounted) {
        const isValid = error ? true : !!data?.valid;
        setCachedValidation(session!.role, session!.authToken!, session!.id, isValid);
        setValidated(isValid);
      }
    };
    run();
    return () => { mounted = false; };
  }, [allowedRoles, session?.role, session?.authToken, session?.id]);

  if (validated === null) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Sitzung wird geprüft...</div>;
  if (!validated) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Auth />} />
          <Route path="/admin" element={<RoleGuard allowedRoles={["admin"]}><Admin /></RoleGuard>} />
          <Route path="/projects" element={<RoleGuard allowedRoles={["admin", "employee"]}><Projects /></RoleGuard>} />
          <Route path="/projects/new" element={<RoleGuard allowedRoles={["admin", "employee"]}><NewProject /></RoleGuard>} />
          <Route path="/projects/customers" element={<RoleGuard allowedRoles={["admin", "employee"]}><CustomerManage /></RoleGuard>} />
          <Route path="/projects/:projectId" element={<RoleGuard allowedRoles={["admin", "employee"]}><ProjectDetail /></RoleGuard>} />
          <Route path="/projects/:projectId/camera" element={<RoleGuard allowedRoles={["admin", "employee"]}><Camera /></RoleGuard>} />
          <Route path="/projects/:projectId/editor" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/location-details" element={<RoleGuard allowedRoles={["admin", "employee"]}><LocationDetails /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/edit" element={<RoleGuard allowedRoles={["admin", "employee"]}><LocationDetails /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit" element={<RoleGuard allowedRoles={["admin", "employee"]}><LocationDetails /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/edit-image" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit-image" element={<RoleGuard allowedRoles={["admin", "employee"]}><PhotoEditor /></RoleGuard>} />
          <Route path="/projects/:projectId/export" element={<RoleGuard allowedRoles={["admin", "employee"]}><Export /></RoleGuard>} />
          <Route path="/projects/:projectId/floor-plans" element={<RoleGuard allowedRoles={["admin", "employee"]}><FloorPlanView /></RoleGuard>} />
          <Route path="/projects/:projectId/floor-plans/upload" element={<RoleGuard allowedRoles={["admin", "employee"]}><FloorPlanUpload /></RoleGuard>} />
          {/* Customer routes - /kunde is public login, /customer is protected */}
          <Route path="/kunde" element={<CustomerLogin />} />
          <Route path="/customer" element={<RoleGuard allowedRoles={["customer"]}><CustomerView /></RoleGuard>} />
          <Route path="/guest/:projectId" element={<GuestAccess />} />
          <Route path="/guest/:projectId/view" element={<GuestProject />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
