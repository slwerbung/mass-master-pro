// Edge function: turn a recorded conversation into a meeting note.
//
// Flow (action "process"):
//   1. Auth: require a valid employee/admin session token.
//   2. Download the uploaded audio from Storage (project-files bucket).
//   3. Transcribe via OpenAI Whisper (German).
//   4. Summarise into a result protocol (Ergebnisprotokoll, NOT verbatim) plus
//      an action plan (Maßnahmenplan) via OpenAI chat (JSON output).
//   5. Write the note to the linked HERO project's logbook (best-effort).
//   6. Store the note in meeting_notes and delete the raw audio again.
//
// Action "list": return recent notes for a project.
//
// Requires OPENAI_API_KEY in the function environment (Supabase secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v9/graphql";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function heroContext(supabase: any, projectId: string): Promise<{ apiKey: string; heroId: number } | null> {
  const { data: cfg } = await supabase.from("app_config").select("key,value").in("key", ["hero_api_key", "hero_enabled"]);
  const map = new Map((cfg || []).map((r: any) => [r.key, r.value]));
  const apiKey = map.get("hero_api_key") as string | undefined;
  const enabled = map.get("hero_enabled") === "true" || map.get("hero_enabled") === true;
  if (!enabled || !apiKey) return null;
  const { data: proj } = await supabase.from("projects").select("custom_fields").eq("id", projectId).maybeSingle();
  const heroId = Number(proj?.custom_fields?.__hero_project_id);
  if (!Number.isFinite(heroId) || heroId <= 0) return null;
  return { apiKey, heroId };
}

async function heroAddLogbook(apiKey: string, heroProjectId: number, title: string, text: string): Promise<boolean> {
  const mutation = `mutation($projectId: Int!, $title: String!, $text: String) { add_logbook_entry(project_match_id: $projectId, custom_title: $title, custom_text: $text) { id } }`;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { projectId: heroProjectId, title: title.slice(0, 500), text: text ? text.slice(0, 5000) : null } }),
    });
    const data = await resp.json();
    return !data.errors?.length;
  } catch {
    return false;
  }
}

async function transcribe(apiKey: string, audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("language", "de");
  form.append("response_format", "text");
  const resp = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Transkription fehlgeschlagen (HTTP ${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  return (await resp.text()).trim();
}

const SUMMARY_SYSTEM = `Du bist Assistent für Gesprächsnotizen einer Schilder-/Werbetechnikfirma.
Aus dem folgenden Transkript eines Gesprächs (Kunde/Mitarbeiter) erstellst du KEIN Wortprotokoll, sondern ein knappes Ergebnisprotokoll auf Deutsch.

Gib ein JSON-Objekt zurück mit genau diesen Feldern:
- "summary": Markdown mit den wichtigsten besprochenen Punkten und getroffenen Entscheidungen als kurze Stichpunkte (Aufzählung mit "- "). Keine Floskeln, nur Ergebnisse.
- "actionPlan": Markdown-Checkliste mit konkreten nächsten Schritten / Maßnahmen ("- [ ] Aufgabe"). Wenn erkennbar, Verantwortliche und Fristen ergänzen. Wenn keine Maßnahmen erkennbar sind, eine leere Liste bzw. "- [ ] Keine offenen Punkte".

Antworte ausschließlich mit dem JSON-Objekt, ohne weitere Erklärung.`;

async function summarise(apiKey: string, transcript: string): Promise<{ summary: string; actionPlan: string }> {
  const resp = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: transcript.slice(0, 50000) },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Zusammenfassung fehlgeschlagen (HTTP ${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      summary: String(parsed.summary || "").trim() || "_Keine Zusammenfassung erkannt._",
      actionPlan: String(parsed.actionPlan || "").trim() || "- [ ] Keine offenen Punkte",
    };
  } catch {
    return { summary: content.slice(0, 4000), actionPlan: "- [ ] Keine offenen Punkte" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, token } = body;

    // Authn: employee or admin session.
    const payload = token ? await verifySessionToken(token, getSessionSecret()) : null;
    if (!payload || (payload.role !== "employee" && payload.role !== "admin")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "list") {
      const projectId = String(body.projectId || "").trim();
      if (!projectId) return json({ notes: [] });
      const { data } = await supabase
        .from("meeting_notes")
        .select("id, summary, action_plan, created_by, hero_logged, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      return json({ notes: data || [] });
    }

    if (action === "process") {
      const projectId = String(body.projectId || "").trim();
      const audioPath = String(body.audioPath || "").trim();
      if (!projectId || !audioPath) return json({ error: "projectId und audioPath erforderlich" }, 400);

      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY ist nicht konfiguriert (Supabase Secrets)." }, 500);
      }

      // Download the uploaded audio.
      const { data: audio, error: dlErr } = await supabase.storage.from("project-files").download(audioPath);
      if (dlErr || !audio) return json({ error: "Audio konnte nicht geladen werden: " + (dlErr?.message || "unbekannt") }, 404);
      if (audio.size > 25 * 1024 * 1024) {
        await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});
        return json({ error: "Aufnahme zu groß (max. 25 MB). Bitte kürzer aufnehmen." }, 400);
      }

      const filename = audioPath.split("/").pop() || "audio.webm";
      let transcript = "";
      try {
        transcript = await transcribe(OPENAI_API_KEY, audio, filename);
      } catch (e: any) {
        await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});
        return json({ error: e.message || "Transkription fehlgeschlagen" }, 502);
      }
      if (!transcript) {
        await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});
        return json({ error: "Leeres Transkript – wurde Sprache aufgenommen?" }, 422);
      }

      let summary = "", actionPlan = "";
      try {
        ({ summary, actionPlan } = await summarise(OPENAI_API_KEY, transcript));
      } catch (e: any) {
        await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});
        return json({ error: e.message || "Zusammenfassung fehlgeschlagen" }, 502);
      }

      // Project number for the logbook title.
      const { data: proj } = await supabase.from("projects").select("project_number").eq("id", projectId).maybeSingle();
      const projectNumber = proj?.project_number || projectId.slice(0, 8);

      // HERO logbook (best-effort).
      let heroLogged = false;
      try {
        const hctx = await heroContext(supabase, projectId);
        if (hctx) {
          const text =
            `ERGEBNISPROTOKOLL\n\n${summary}\n\n` +
            `MASSNAHMENPLAN\n\n${actionPlan}`;
          heroLogged = await heroAddLogbook(hctx.apiKey, hctx.heroId, `Captfix: Gesprächsnotiz · ${projectNumber}`, text);
        }
      } catch { /* best-effort */ }

      // Store the note; drop the raw audio.
      const createdBy = (payload as any).name || (payload.role === "admin" ? "Admin" : "Mitarbeiter");
      const { data: inserted } = await supabase.from("meeting_notes").insert({
        project_id: projectId,
        summary,
        action_plan: actionPlan,
        transcript,
        created_by: createdBy,
        hero_logged: heroLogged,
      }).select("id, created_at").maybeSingle();

      await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});

      return json({ id: inserted?.id, summary, actionPlan, heroLogged, projectNumber });
    }

    return json({ error: `Unbekannte Aktion: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
