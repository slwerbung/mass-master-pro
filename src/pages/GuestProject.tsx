import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

const GuestProject = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectId) {
      navigate("/", { replace: true });
      return;
    }
    navigate(`/customer?project=${projectId}`, { replace: true });
  }, [navigate, projectId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <p className="text-muted-foreground">Leite weiter...</p>
    </div>
  );
};

export default GuestProject;
