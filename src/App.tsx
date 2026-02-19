import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import Camera from "./pages/Camera";
import PhotoEditor from "./pages/PhotoEditor";
import LocationDetails from "./pages/LocationDetails";
import Export from "./pages/Export";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/camera" element={<Camera />} />
          <Route path="/projects/:projectId/editor" element={<PhotoEditor />} />
          <Route path="/projects/:projectId/location-details" element={<LocationDetails />} />
          <Route path="/projects/:projectId/locations/:locationId/edit" element={<LocationDetails />} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit" element={<LocationDetails />} />
          <Route path="/projects/:projectId/locations/:locationId/edit-image" element={<PhotoEditor />} />
          <Route path="/projects/:projectId/locations/:locationId/details/:detailId/edit-image" element={<PhotoEditor />} />
          <Route path="/projects/:projectId/export" element={<Export />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
