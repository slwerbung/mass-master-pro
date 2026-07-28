// Gives a customer a real Supabase session -- without changing the login.
//
// The customer still just types their name (or opens their project link). The
// Supabase Auth account behind it uses a technical address that is derived from
// the customer id and never shown, never typed, never mailed. Its password is
// replaced with a fresh random value on every login, so it is not a credential
// anybody could reuse.
//
// The point of the session: with a real JWT the database can tell who is
// asking, and the RLS policies can limit the customer to the projects assigned
// to them. Without it every customer view runs on the public anon key.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IssuedSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

function technicalEmail(customerId: string) {
  return `customer-${customerId}@captfix.invalid`;
}

/**
 * Ensures the auth account + profile for this customer exist and returns a
 * fresh session. Returns null on any problem -- the caller then simply
 * continues without a Supabase session, so the login never fails because of
 * this. (Solange die anon-Policies noch stehen, funktioniert die Ansicht auch
 * ohne Session; danach ist das der Punkt, an dem man es merken wuerde.)
 */
export async function issueCustomerSession(
  sb: SupabaseClient,
  customerId: string,
  displayName: string,
): Promise<IssuedSession | null> {
  try {
    const email = technicalEmail(customerId);
    // Neues Zufallspasswort bei jeder Anmeldung: es wird nur einmal benutzt.
    const password = crypto.randomUUID() + crypto.randomUUID();

    const { data: profile } = await sb
      .from("profiles")
      .select("id")
      .eq("customer_id", customerId)
      .maybeSingle();

    let userId: string | null = (profile?.id as string) ?? null;

    if (!userId) {
      const { data: created, error } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, customer_id: customerId },
      });

      if (created?.user) {
        userId = created.user.id;
      } else {
        // Kann nur passieren, wenn ein Auth-Benutzer ohne Profil zurueckblieb.
        // Dann den vorhandenen weiterverwenden statt dauerhaft zu scheitern.
        const { data: existingId } = await sb.rpc("auth_user_id_by_email", { p_email: email });
        if (!existingId) {
          console.error("issueCustomerSession: createUser failed", error?.message);
          return null;
        }
        userId = existingId as string;
        const { error: pwErr } = await sb.auth.admin.updateUserById(userId, { password });
        if (pwErr) return null;
      }

      const { error: profErr } = await sb.from("profiles").upsert({
        id: userId,
        display_name: displayName,
        role: "kunde",
        customer_id: customerId,
      });
      if (profErr) {
        console.error("issueCustomerSession: profile insert failed", profErr.message);
        return null;
      }
    } else {
      const { error: pwErr } = await sb.auth.admin.updateUserById(userId, { password });
      if (pwErr) {
        console.error("issueCustomerSession: password update failed", pwErr.message);
        return null;
      }
    }

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn?.session) {
      console.error("issueCustomerSession: sign in failed", signInErr?.message);
      return null;
    }

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_at: signIn.session.expires_at,
    };
  } catch (e) {
    console.error("issueCustomerSession failed", e);
    return null;
  }
}
