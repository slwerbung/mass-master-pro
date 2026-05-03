import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Renders the "Datenschutzerklärung" link in customer-facing forms with
 * the URL configured in the admin settings.
 *
 * The URL is loaded from app_config via the public `get_privacy_url`
 * action of the admin-manage edge function, so this works without auth.
 *
 * If no URL is configured (admin hasn't set one yet), the link points to
 * the built-in /datenschutz page so the form keeps working out of the box
 * with a generic but DSGVO-compliant privacy notice.
 */
// Fallback URL points to the in-app privacy policy page (relative path)
const FALLBACK_URL = "/datenschutz";

// Module-level cache: URL is the same for everyone, doesn't change during a
// session, and several forms use this component. Promise-based so concurrent
// mounts share a single in-flight request.
let urlPromise: Promise<string | null> | null = null;

async function fetchUrl(): Promise<string | null> {
  if (urlPromise) return urlPromise;
  urlPromise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-manage", {
        body: { action: "get_privacy_url" },
      });
      if (error) return null;
      return (data?.url as string) || null;
    } catch {
      return null;
    }
  })();
  return urlPromise;
}

type Props = {
  /** Override link label; defaults to "Datenschutzerklärung". */
  children?: React.ReactNode;
  className?: string;
};

export const PrivacyLink = ({
  children = "Datenschutzerklärung",
  className = "underline text-primary",
}: Props) => {
  const [url, setUrl] = useState<string>(FALLBACK_URL);

  useEffect(() => {
    let cancelled = false;
    fetchUrl().then(u => {
      if (!cancelled && u) setUrl(u);
    });
    return () => { cancelled = true; };
  }, []);

  const isExternal = /^https?:\/\//i.test(url);

  return (
    <a
      href={url}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      className={className}
    >
      {children}
    </a>
  );
};
