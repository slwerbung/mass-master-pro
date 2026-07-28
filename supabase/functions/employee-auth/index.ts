// Employee login backed by Supabase Auth -- without changing how the login
// LOOKS or FEELS.
//
// The employee still picks their name from a list and types a password. The
// e-mail address that Supabase Auth requires is pure plumbing: it is stored on
// auth.users, resolved here server-side from the employee id, and never shown
// or typed by anyone.
//
// Actions:
//   login          (public)      employeeId + password -> real Supabase session
//   create_login   (admin token) attach e-mail + password to an employee
//   update_login   (admin token) change e-mail and/or password
//   status         (admin token) which employees already have an auth account
//
// Why a real session matters: it gives the browser a genuine Supabase JWT, so
// RLS can identify the user via auth.uid(). That is the prerequisite for
// closing the wide-open anon policies in phase 2.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "https://esm.sh/bcryptjs@3.0.2";
import { createSessionToken, getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

/** Requires a valid admin session token from the existing token system. */
async function requireAdmin(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token) return false;
  const payload = await verifySessionToken(token, getSessionSecret());
  return !!payload && payload.role === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body.action || "");
    const sb = admin();

    // -- login ------------------------------------------------------------
    // Public on purpose: it is the login endpoint. Credentials are verified by
    // Supabase Auth itself, so a wrong password simply fails here.
    if (action === "login") {
      const employeeId = String(body.employeeId || "").trim();
      const password = String(body.password || "");
      if (!employeeId || !password) return json({ error: "employeeId und password erforderlich" }, 400);

      // employee -> profile -> auth user id -> e-mail
      const { data: profile } = await sb
        .from("profiles")
        .select("id, display_name, role, is_active")
        .eq("employee_id", employeeId)
        .maybeSingle();

      // No auth account yet -> caller falls back to the legacy bcrypt login,
      // so a half-migrated team keeps working.
      if (!profile) return json({ noAuthAccount: true });
      if (!profile.is_active) return json({ error: "Zugang deaktiviert" }, 403);

      const { data: userRes } = await sb.auth.admin.getUserById(profile.id as string);
      const email = userRes?.user?.email;
      if (!email) return json({ noAuthAccount: true });

      // Verify the password by actually signing in (anon client, like a browser).
      const anon = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      let { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });

      // Sicherheitsnetz fuer die Migration: Die Auth-Konten wurden mit den
      // bestehenden bcrypt-Hashes der employees-Tabelle angelegt, damit
      // niemand sein Passwort aendern muss. Sollte ein Hash wider Erwarten
      // nicht akzeptiert werden, pruefen wir hier gegen den alten Hash und
      // reparieren das Konto still. So kann sich niemand aussperren.
      if (signInErr || !signIn?.session) {
        const { data: legacy } = await sb
          .from("employees")
          .select("password_hash")
          .eq("id", employeeId)
          .maybeSingle();
        const legacyOk = legacy?.password_hash
          ? bcrypt.compareSync(password, legacy.password_hash as string)
          : false;
        if (!legacyOk) return json({ valid: false, error: "Falsches Passwort" }, 401);

        const { error: repairErr } = await sb.auth.admin.updateUserById(profile.id as string, { password });
        if (repairErr) return json({ valid: false, error: "Falsches Passwort" }, 401);
        ({ data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password }));
        if (signInErr || !signIn?.session) return json({ valid: false, error: "Falsches Passwort" }, 401);
      }

      // Zusaetzlich das bestehende HMAC-Token ausstellen: alle Edge Functions
      // erwarten es weiterhin. So aendert sich fuer den Rest der App nichts.
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
      const token = await createSessionToken(
        { role: "employee", userId: employeeId, exp },
        getSessionSecret(),
      );

      return json({
        valid: true,
        token,
        expiresAt: new Date(exp * 1000).toISOString(),
        session: {
          access_token: signIn.session.access_token,
          refresh_token: signIn.session.refresh_token,
          expires_at: signIn.session.expires_at,
        },
        profile: {
          id: profile.id,
          displayName: profile.display_name,
          role: profile.role,
          employeeId,
        },
      });
    }

    // -- create_login (admin) ---------------------------------------------
    if (action === "create_login") {
      if (!(await requireAdmin(body.token))) return json({ error: "Unauthorized" }, 401);

      const employeeId = String(body.employeeId || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = body.role === "admin" ? "admin" : "mitarbeiter";
      if (!employeeId) return json({ error: "employeeId erforderlich" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ung\u00fcltige E-Mail-Adresse" }, 400);
      if (password.length < 8) return json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400);

      const { data: emp } = await sb.from("employees").select("id, name").eq("id", employeeId).maybeSingle();
      if (!emp) return json({ error: "Mitarbeiter nicht gefunden" }, 404);

      const { data: existing } = await sb.from("profiles").select("id").eq("employee_id", employeeId).maybeSingle();
      if (existing) return json({ error: "F\u00fcr diesen Mitarbeiter existiert bereits ein Login" }, 409);

      // email_confirm: true -- no confirmation mail; the admin hands over the
      // password directly, and the address is never used for login anyway.
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: emp.name, employee_id: employeeId },
      });
      if (createErr || !created?.user) {
        return json({ error: "Anlage fehlgeschlagen: " + (createErr?.message || "unbekannt") }, 400);
      }

      const { error: profErr } = await sb.from("profiles").insert({
        id: created.user.id,
        display_name: emp.name,
        role,
        employee_id: employeeId,
      });
      if (profErr) {
        // Roll back the auth user so a retry isn't blocked by a half-created state.
        await sb.auth.admin.deleteUser(created.user.id).catch(() => {});
        return json({ error: "Profil-Anlage fehlgeschlagen: " + profErr.message }, 500);
      }

      // Dieselbe Adresse auf dem employees-Datensatz spiegeln: dort holt sie
      // send-notification fuer den Empfaenger "zugeordneter Mitarbeiter".
      // Und denselben Passwort-Hash, damit der alte Login-Weg (aeltere, noch
      // gecachte App-Version im Browser) dasselbe Passwort akzeptiert.
      await sb.from("employees")
        .update({ email, password_hash: bcrypt.hashSync(password, 10) })
        .eq("id", employeeId);

      return json({ success: true, userId: created.user.id, name: emp.name, role });
    }

    // -- update_login (admin) ---------------------------------------------
    if (action === "update_login") {
      if (!(await requireAdmin(body.token))) return json({ error: "Unauthorized" }, 401);

      const employeeId = String(body.employeeId || "").trim();
      const { data: profile } = await sb.from("profiles").select("id").eq("employee_id", employeeId).maybeSingle();
      if (!profile) return json({ error: "Kein Login f\u00fcr diesen Mitarbeiter" }, 404);

      const attrs: Record<string, unknown> = {};
      if (body.email != null && String(body.email).trim()) {
        const email = String(body.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ung\u00fcltige E-Mail-Adresse" }, 400);
        attrs.email = email;
        attrs.email_confirm = true;
        await sb.from("employees").update({ email }).eq("id", employeeId);
      }
      if (body.password != null && String(body.password)) {
        if (String(body.password).length < 8) return json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400);
        attrs.password = String(body.password);
        // Alten Hash mitziehen, damit beide Login-Wege dasselbe Passwort haben.
        await sb.from("employees")
          .update({ password_hash: bcrypt.hashSync(String(body.password), 10) })
          .eq("id", employeeId);
      }
      if (Object.keys(attrs).length > 0) {
        const { error } = await sb.auth.admin.updateUserById(profile.id as string, attrs as any);
        if (error) return json({ error: "\u00c4nderung fehlgeschlagen: " + error.message }, 400);
      }

      const patch: Record<string, unknown> = {};
      if (body.role === "admin" || body.role === "mitarbeiter") patch.role = body.role;
      if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
      if (Object.keys(patch).length > 0) {
        await sb.from("profiles").update(patch).eq("id", profile.id);
      }

      return json({ success: true });
    }

    // -- status (admin) ---------------------------------------------------
    if (action === "status") {
      if (!(await requireAdmin(body.token))) return json({ error: "Unauthorized" }, 401);

      const { data: emps } = await sb.from("employees").select("id, name").order("name");
      const { data: profs } = await sb.from("profiles").select("id, employee_id, role, is_active");
      const byEmp = new Map((profs || []).map((p: any) => [p.employee_id, p]));

      // Resolve e-mails so the admin can see which address belongs to whom.
      const out = [];
      for (const e of emps || []) {
        const p: any = byEmp.get(e.id);
        let email: string | null = null;
        if (p) {
          const { data: u } = await sb.auth.admin.getUserById(p.id);
          email = u?.user?.email ?? null;
        }
        out.push({
          employeeId: e.id,
          name: e.name,
          hasLogin: !!p,
          email,
          role: p?.role ?? null,
          isActive: p?.is_active ?? null,
        });
      }
      return json({ employees: out });
    }

    return json({ error: `Unbekannte Aktion: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
