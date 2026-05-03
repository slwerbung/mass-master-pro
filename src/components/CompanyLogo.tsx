import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Renders the company logo uploaded by the admin in the settings page.
 * Used across customer-facing surfaces (public forms, guest views, customer
 * portal) to make it clear which company the data belongs to.
 *
 * Loads via the `admin-manage` edge function with action "get_logo", which is
 * a public action so the call works without authentication. Returns nothing
 * if there is no logo configured - so callers can safely render it without
 * worrying about empty boxes.
 *
 * Styling defaults to a sensible header size (max 64px height, auto width)
 * but can be overridden via `className` for tighter or larger layouts.
 */
type Props = {
  /** Override Tailwind classes for the <img>; defaults are good for headers. */
  className?: string;
  /** Wrapper classes - useful for centering or spacing. */
  wrapperClassName?: string;
  /** Alt text override; defaults to a generic "Firmenlogo". */
  alt?: string;
};

// Module-level cache: the logo doesn't change during a session and we use the
// component on multiple pages, so we avoid re-fetching the same Base64 blob
// every time. Promise-based so concurrent mounts share a single in-flight
// request rather than hammering the function.
let logoPromise: Promise<string | null> | null = null;

async function fetchLogo(): Promise<string | null> {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-manage", {
        body: { action: "get_logo" },
      });
      if (error) return null;
      return (data?.logo as string) || null;
    } catch {
      return null;
    }
  })();
  return logoPromise;
}

export const CompanyLogo = ({
  className = "max-h-16 w-auto",
  wrapperClassName = "",
  alt = "Firmenlogo",
}: Props) => {
  const [logo, setLogo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLogo().then(l => {
      if (!cancelled) {
        setLogo(l);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Don't render a placeholder while loading - we want a clean look without
  // visible loading flicker. Once loaded, render only if we got a logo.
  if (!loaded || !logo) return null;

  return (
    <div className={wrapperClassName}>
      <img src={logo} alt={alt} className={className} />
    </div>
  );
};
