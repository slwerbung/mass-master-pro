import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { usePublicLinkConfig } from "@/lib/publicLinks";

/**
 * Kundenseiten unter /:firma/… (Spec B). Stimmt der Firmenname im Pfad nicht mit dem eingestellten überein, wird auf
 * denselben Pfad mit dem richtigen Namen umgeleitet (im Effekt, nie im Render). Ist die Einstellung nicht ladbar,
 * wird die Seite trotzdem gezeigt – ein Kundenlink darf daran nie scheitern.
 */
export default function SlugRoute({ children }: { children: React.ReactNode }) {
  const { firma = "" } = useParams();
  const { config, loading } = usePublicLinkConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const wrong = !!config && firma.toLowerCase() !== config.slug.toLowerCase();

  useEffect(() => {
    if (!wrong || !config) return;
    const rest = location.pathname.split("/").slice(2).join("/");
    navigate(`/${config.slug}/${rest}${location.search}${location.hash}`, { replace: true });
  }, [wrong, config, location.pathname, location.search, location.hash, navigate]);

  if (loading || wrong) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">wird geladen...</div>;
  }
  return <>{children}</>;
}
