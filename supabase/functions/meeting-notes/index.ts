// Edge function: turn a recorded conversation into a meeting note.
//
// Flow (action "process"):
//   1. Auth: require a valid employee/admin session token.
//   2. Download the uploaded audio from Storage (project-files bucket).
//   3. Transcribe via Whisper (Groq or OpenAI), German.
//   4. Summarise into a result protocol (Ergebnisprotokoll, NOT verbatim) plus
//      an action plan (Maßnahmenplan) via chat completion (JSON output).
//   5. Write the note to the linked HERO project's logbook (best-effort).
//   6. Store the note in meeting_notes and delete the raw audio again.
//
// Action "list": return recent notes for a project.
//
// Requires GROQ_API_KEY (free) or OPENAI_API_KEY in the function environment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v9/graphql";

// AI provider: prefer Groq (free tier, no card) if its key is set, else
// OpenAI. Both expose an OpenAI-compatible /audio/transcriptions and
// /chat/completions API, so only base URL + model + key differ.
interface AIProvider { name: string; base: string; key: string; transcribeModel: string; chatModel: string }
function resolveProvider(): AIProvider | null {
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    return { name: "groq", base: "https://api.groq.com/openai/v1", key: groq, transcribeModel: "whisper-large-v3", chatModel: "llama-3.3-70b-versatile" };
  }
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) {
    return { name: "openai", base: "https://api.openai.com/v1", key: openai, transcribeModel: "whisper-1", chatModel: "gpt-4o-mini" };
  }
  return null;
}

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

async function heroAddLogbook(apiKey: string, heroProjectId: number, title: string, text: string): Promise<{ ok: boolean; error?: string }> {
  // HERO v9: add_logbook_entry takes a single LogbookEntryInput. There is no
  // separate title field, so the title is folded into custom_text (required).
  const mutation = `mutation($entry: LogbookEntryInput!) { add_logbook_entry(logbook_entry: $entry) { id } }`;
  const customText = ([title, text].filter(Boolean).join("\n\n") || title).slice(0, 5000);
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { entry: { target: "project_match", target_id: heroProjectId, custom_text: customText } } }),
    });
    const raw = await resp.text();
    if (!resp.ok) {
      return { ok: false, error: `HERO HTTP ${resp.status}: ${raw.slice(0, 400)}` };
    }
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: `HERO lieferte kein JSON: ${raw.slice(0, 400)}` };
    }
    if (data?.errors?.length) {
      return { ok: false, error: `HERO GraphQL: ${JSON.stringify(data.errors).slice(0, 400)}` };
    }
    if (!data?.data?.add_logbook_entry?.id) {
      return { ok: false, error: `HERO: keine Eintrags-ID zurückgegeben: ${raw.slice(0, 400)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `HERO Anfrage fehlgeschlagen: ${e?.message || String(e)}` };
  }
}

async function transcribe(p: AIProvider, audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", p.transcribeModel);
  form.append("language", "de");
  form.append("response_format", "text");
  const resp = await fetch(`${p.base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}` },
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

// Generic prompt for the standalone protocol app (/protokoll). The user gives
// a briefing (context + how the protocol should be made) beforehand, which is
// injected below so the AI knows what kind of meeting it is (e.g. a committee /
// board session – Gremiensitzung) and how to structure the result.
const SUMMARY_SYSTEM_GENERIC = `Du bist ein Assistent, der aus dem Transkript eines gesprochenen Termins ein professionelles Ergebnisprotokoll auf Deutsch erstellt – KEIN Wortprotokoll.

Gib ein JSON-Objekt zurück mit genau diesen Feldern:
- "summary": Markdown-Ergebnisprotokoll. Nutze Überschriften ("## ") für Themen/Tagesordnungspunkte, darunter kurze Stichpunkte ("- ") mit den besprochenen Inhalten, getroffenen Entscheidungen und Beschlüssen. Keine Floskeln, nur Ergebnisse.
- "actionPlan": Markdown-Checkliste mit konkreten Maßnahmen / nächsten Schritten ("- [ ] Aufgabe"). Wenn erkennbar, Verantwortliche und Fristen ergänzen. Wenn keine Maßnahmen erkennbar sind: "- [ ] Keine offenen Punkte".

Halte dich strikt an den vom Nutzer vorgegebenen Kontext und die Protokoll-Anweisung. Antworte ausschließlich mit dem JSON-Objekt, ohne weitere Erklärung.`

// Builds the system prompt. Without a briefing the original project prompt is
// used (unchanged). With a briefing the generic prompt + the user's context
// and instructions are used.
function buildSummarySystem(briefing?: { context?: string; instructions?: string }): string {
  const context = (briefing?.context || "").trim();
  const instructions = (briefing?.instructions || "").trim();
  if (!context && !instructions) return SUMMARY_SYSTEM;
  let out = SUMMARY_SYSTEM_GENERIC;
  if (context) out += `\n\nKONTEXT DES TERMINS (vom Nutzer vorab):\n${context.slice(0, 4000)}`;
  if (instructions) out += `\n\nSO SOLL DAS PROTOKOLL ERSTELLT WERDEN (Anweisung des Nutzers):\n${instructions.slice(0, 4000)}`;
  return out;
}

async function summarise(p: AIProvider, transcript: string, system: string): Promise<{ summary: string; actionPlan: string }> {
  const resp = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
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
      // Standalone protocols (/protokoll app): projectless notes, newest first.
      if (body.standalone === true) {
        const { data } = await supabase
          .from("meeting_notes")
          .select("id, title, summary, action_plan, context, created_by, created_at")
          .is("project_id", null)
          .order("created_at", { ascending: false })
          .limit(30);
        return json({ notes: data || [] });
      }
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
      // Standalone (projectless) protocols come with a briefing instead of a
      // project. Everything runs the same way; only HERO logging is skipped.
      const standalone = !projectId;
      const briefContext = String(body.context || "").trim();
      const briefInstructions = String(body.instructions || "").trim();
      const briefTitle = String(body.title || "").trim();
      if (!audioPath) return json({ error: "audioPath erforderlich" }, 400);
      if (!standalone && !projectId) return json({ error: "projectId erforderlich" }, 400);

      const provider = resolveProvider();
      if (!provider) {
        return json({ error: "Kein KI-Key konfiguriert (GROQ_API_KEY oder OPENAI_API_KEY in den Supabase Secrets)." }, 500);
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
        transcript = await transcribe(provider, audio, filename);
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
        const system = buildSummarySystem(standalone ? { context: briefContext, instructions: briefInstructions } : undefined);
        ({ summary, actionPlan } = await summarise(provider, transcript, system));
      } catch (e: any) {
        await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});
        return json({ error: e.message || "Zusammenfassung fehlgeschlagen" }, 502);
      }

      // HERO logbook only for project-bound notes (standalone protocols like
      // Gremiensitzungen have no linked HERO project).
      let projectNumber = "";
      let heroLogged = false;
      let heroError: string | undefined;
      if (!standalone) {
        const { data: proj } = await supabase.from("projects").select("project_number").eq("id", projectId).maybeSingle();
        projectNumber = proj?.project_number || projectId.slice(0, 8);
        // Best-effort. Surface WHY it failed instead of a misleading generic
        // "not linked" message.
        try {
          const hctx = await heroContext(supabase, projectId);
          if (!hctx) {
            heroError = "Projekt nicht mit HERO verknüpft oder Integration aus.";
          } else {
            const text =
              `ERGEBNISPROTOKOLL\n\n${summary}\n\n` +
              `MASSNAHMENPLAN\n\n${actionPlan}`;
            const res = await heroAddLogbook(hctx.apiKey, hctx.heroId, `Captfix: Gesprächsnotiz · ${projectNumber}`, text);
            heroLogged = res.ok;
            if (!res.ok) heroError = res.error;
          }
        } catch (e: any) {
          heroError = e?.message || String(e);
        }
      }

      // Store the note; drop the raw audio.
      const createdBy = (payload as any).name || (payload.role === "admin" ? "Admin" : "Mitarbeiter");
      const briefingCombined = [briefContext, briefInstructions].filter(Boolean).join("\n\n---\n\n") || null;
      const { data: inserted } = await supabase.from("meeting_notes").insert({
        project_id: standalone ? null : projectId,
        kind: standalone ? "standalone" : "project",
        title: briefTitle || null,
        context: standalone ? briefingCombined : null,
        summary,
        action_plan: actionPlan,
        transcript,
        created_by: createdBy,
        hero_logged: heroLogged,
      }).select("id, created_at").maybeSingle();

      await supabase.storage.from("project-files").remove([audioPath]).catch(() => {});

      return json({ id: inserted?.id, title: briefTitle, summary, actionPlan, heroLogged, heroError, projectNumber, standalone });
    }

    return json({ error: `Unbekannte Aktion: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
