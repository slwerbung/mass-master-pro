import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import Camera from "./pages/Camera";
import PhotoEditor from "./pages/PhotoEditor";
import LocationDetails from "./pages/LocationDetails";
import Export from "./pages/Export";
import Auth from "./pages/Auth";
import GuestAccess from "./pages/GuestAccess";
import GuestProject from "./pages/GuestProject";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<any>(undefined);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // loading
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/auth" element={<Auth />} />
          <Route path="/guest/:projectId" element={<GuestAccess />} />
          <Route path="/guest/:projectId/view" element={<GuestProject />} />

          {/* Protected routes */}
          <Route path="/" element={<AuthGuard><Projects /></AuthGuard>} />
          <Route path="/projects/new" element={<AuthGuard><NewProject /></AuthGuard>} />
          <Route path="/projects/:projectId" element={<AuthGuard><ProjectDetail /></AuthGuard>} />
          <Route path="/projects/:projectId/camera" element={<AuthGuard><Camera /></AuthGuard>} />
          <Route path="/projects/:projectId/editor" element={<AuthGuard><PhotoEditor /></AuthGuard>} />
          <Route path="/projects/:projectId/location-details" element={<AuthGuard><LocationDetails /></AuthGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/edit" element={<AuthGuard><LocationDetails /></AuthGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit" element={<AuthGuard><LocationDetails /></AuthGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/edit-image" element={<AuthGuard><PhotoEditor /></AuthGuard>} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit-image" element={<AuthGuard><PhotoEditor /></AuthGuard>} />
          <Route path="/projects/:projectId/export" element={<AuthGuard><Export /></AuthGuard>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
