import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSession, setSession } from "@/lib/session";

const GuestProject = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectId) {
      navigate("/", { replace: true });
      return;
    }

    const guestToken = localStorage.getItem("guest_token");
    const guestName = localStorage.getItem("guest_name") || "Gast";
    const session = getSession();

    if (!guestToken) {
      navigate(`/guest/${projectId}`, { replace: true });
      return;
    }

    if (!session || session.role !== "customer") {
      setSession({ role: "customer", id: `guest:${guestName}`, name: guestName });
    }

    navigate(`/customer?project=${projectId}`, { replace: true });
  }, [navigate, projectId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <p className="text-muted-foreground">Laden...</p>
    </div>
  );
};

export default GuestProject;
