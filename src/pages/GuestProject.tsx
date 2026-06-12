import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getSession, setSession } from "@/lib/session";

const isRealCustomerId = (value?: string | null) => !!value && !String(value).startsWith("guest:");

// Legacy direct-link entry (/guest/:projectId/view). Unified with the regular
// customer flow: instead of a fake "guest:" session, we provision a real
// customer (find-or-create) via ensure-customer-assignment, exactly like
// GuestAccess does. From there the app treats direct-link and login identically.
const GuestProject = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectId) {
      navigate("/", { replace: true });
      return;
    }

    const session = getSession();

    // Already a real customer? Go straight to the project.
    if (session && session.role === "customer" && isRealCustomerId(session.id)) {
      navigate(`/customer?project=${projectId}`, { replace: true });
      return;
    }

    const guestName = localStorage.getItem("guest_name");
    if (!guestName) {
      // No name yet — let GuestAccess collect it (and handle any password).
      navigate(`/guest/${projectId}`, { replace: true });
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("ensure-customer-assignment", {
          body: { projectId, customerName: guestName },
        });
        if (error || !data?.success || !data?.token || !data?.customer?.id) {
          navigate(`/guest/${projectId}`, { replace: true });
          return;
        }
        localStorage.removeItem("guest_token");
        setSession({
          role: "customer",
          id: data.customer.id,
          name: data.customer.name || guestName,
          authToken: data.token,
          expiresAt: data.expiresAt,
        });
        navigate(`/customer?project=${projectId}`, { replace: true });
      } catch {
        navigate(`/guest/${projectId}`, { replace: true });
      }
    })();
  }, [navigate, projectId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <p className="text-muted-foreground">Laden...</p>
    </div>
  );
};

export default GuestProject;
