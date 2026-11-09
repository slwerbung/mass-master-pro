// Edge function: staff side of the Standort-Chat (location_feedback).
//
// After the Phase-2 RLS lockdown, location_feedback is writable only by an
// authenticated Supabase-Auth staff user (is_staff()). Employees who log in
// without a password get NO Supabase session, and password sessions expire —
// so their direct client writes were silently denied by RLS ("Kommentar kam
// nicht an"). This function performs the staff read/write with the service
// role after validating the employee/admin HMAC session token, exactly like
// customer writes go through customer-data.
//
// Actions (all require a valid admin/employee token):
//   - list   { locationId }            -> messages of a location
//   - send   { locationId, message }   -> insert a staff reply
//   - delete { id }                    -> delete a message
//   - toggle { id, status }            -> set status open/done (nur Top-Level-Kommentare)
//   - update_markup { id, markup }     -> eigene Markierung aendern (Spec C)
// send nimmt optional parentId (Antwort, eine Ebene) bzw. markup + mediaRef (Markierung auf einer Datei).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { prepareFeedbackExtras } from "../_shared/feedbackMarkup.ts";
import { validateMarkup } from "../_shared/markup.ts";

const COLS = "id, location_id, message, author_name, author_type, author_customer_id, status, created_at, resolved_at, parent_id, markup, media_ref";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { token, action, ...params } = body;

    const payload = token ? await verifySessionToken(token, getSessionSecret()) : null;
    if (!payload || (payload.role !== "employee" && payload.role !== "admin")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "list") {
      const locationId = String(params.locationId || "").trim();
      if (!locationId) return json({ messages: [] });
      const { data, error } = await supabase
        .from("location_feedback")
        .select(COLS)
        .eq("location_id", locationId)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ messages: data || [] });
    }

    if (action === "send") {
      const locationId = String(params.locationId || "").trim();
      const message = String(params.message || "").trim();
      if (!locationId) return json({ error: "locationId erforderlich" }, 400);
      if (!message) return json({ error: "Nachricht ist leer" }, 400);
      const clientName = String(params.name || "").trim();
      const authorName = clientName || (payload as any).name || (payload.role === "admin" ? "Admin" : "Mitarbeiter");
      const extras = await prepareFeedbackExtras(supabase, locationId, { parentId: params.parentId, markup: params.markup, mediaRef: params.mediaRef });
      if (!extras.ok) return json({ error: extras.error }, 400);
      const { data, error } = await supabase
        .from("location_feedback")
        .insert({
          location_id: locationId,
          author_name: authorName,
          author_type: "employee",
          author_customer_id: null,
          message: message.slice(0, 4000),
          status: "open",
          ...extras.extras,
        })
        .select(COLS)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ message: data });
    }

    if (action === "delete") {
      const id = String(params.id || "").trim();
      if (!id) return json({ error: "id erforderlich" }, 400);
      const { error } = await supabase.from("location_feedback").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    if (action === "toggle") {
      const id = String(params.id || "").trim();
      const status = params.status === "done" ? "done" : "open";
      if (!id) return json({ error: "id erforderlich" }, 400);
      const { data: row } = await supabase.from("location_feedback").select("parent_id").eq("id", id).maybeSingle();
      if (!row) return json({ error: "Nachricht nicht gefunden" }, 404);
      if (row.parent_id) return json({ error: "Nur Kommentare (keine Antworten) haben einen Status." }, 400);
      const { error } = await supabase
        .from("location_feedback")
        .update({ status, resolved_at: status === "done" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    if (action === "update_markup") {
      const id = String(params.id || "").trim();
      if (!id) return json({ error: "id erforderlich" }, 400);
      const { data: row } = await supabase.from("location_feedback").select("parent_id, media_ref, author_type").eq("id", id).maybeSingle();
      if (!row) return json({ error: "Nachricht nicht gefunden" }, 404);
      if (row.parent_id || !row.media_ref || row.author_type !== "employee") return json({ error: "Nur eigene Markierungen des Teams sind änderbar." }, 400);
      const m = validateMarkup(params.markup);
      if (!m.ok) return json({ error: m.error }, 400);
      const patch: Record<string, unknown> = { markup: m.markup };
      if (typeof params.message === "string" && params.message.trim()) patch.message = params.message.trim().slice(0, 4000);
      const { error } = await supabase.from("location_feedback").update(patch).eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
