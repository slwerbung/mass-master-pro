import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen (siehe .env.example).");
}

// Eigene Anmeldung ueber Supabase Auth (E-Mail + Passwort, keine Selbstregistrierung).
// Eigener Speicherschluessel, damit sich die Sitzung nicht mit CaptFix vermischt.
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "mail-assistent-auth" },
});
