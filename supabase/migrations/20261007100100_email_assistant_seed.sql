-- KI-Mail-Assistent: Startbelegung (Seed). Alles hier ist im Admin-Bereich der
-- Mail-App aenderbar; die HERO-IDs lassen sich per Knopf aus HERO neu laden.
-- Idempotent: bestehende Werte werden nicht ueberschrieben.
--
-- HERO-Dokumenttypen (upload_document braucht eine document_type_id, KEINE Ordner-ID): Plan / Layout 338164,
-- Aufmassdokument 279269, Druckdaten 428979 (Stand 23.09.2026 laut HERO-Introspection). Fahrzeugdaten und
-- Allgemein haben keinen eigenen Typ und nutzen „Plan / Layout"; bitte im Admin-Bereich pruefen.

insert into public.email_config (key, value) values
  ('folders', '{
    "kunden": "1 Kunden & Projekte",
    "lieferanten": "2 Lieferanten & Bestellungen",
    "belege": "3 Belege & Rechnungen",
    "ausschreibungen": "4 Ausschreibungen",
    "verwaltung": "5 Verwaltung",
    "newsletter": "6 Newsletter & Infos",
    "system": "7 System",
    "belegabholung": "8 Belege abholen (Portal)",
    "aussortiert": "9 Aussortiert"
  }'::jsonb),
  ('gewerke', '[
    {"short": "WER", "name": "Werbetechnik", "measure_id": 6619, "default": true},
    {"short": "TEX", "name": "Textildruck", "measure_id": 6620, "default": false,
     "services": ["Textildruck"], "keywords": ["textil", "t-shirt", "shirt", "hoodie", "polo", "stick", "arbeitskleidung"]}
  ]'::jsonb),
  ('hero', '{
    "project_type_id": 181,
    "start_step_id": 2825,
    "steps": {
      "angebot": 266511, "vor_ort": 266510, "detailgespraech": 266647, "projektplanung": 266512,
      "visualisierung": 266370, "materialbestellung": 266740, "produktionsdaten": 266371, "reklamation": 2835,
      "warten_auftrag": 266648, "warten_layout": 266649, "warten_ware": 266741
    },
    "excluded_steps": [2834, 2836, 2837],
    "offer_document_type_id": 171300,
    "document_types": {
      "layouts": 338164, "aufmasse": 279269, "druckdaten": 428979, "fahrzeugdaten": 338164, "allgemein": 338164
    }
  }'::jsonb),
  ('company_knowledge', to_jsonb('SL WERBUNG, Winnenden. Leistungen: Fahrzeugbeschriftung, Schilder, Leitsysteme, Folierung, Digitaldruck, Textildruck, Splitterschutz, Montage. Typischer Ablauf: Anfrage, Angebot, Auftragsbestaetigung, Layout und Freigabe, Produktion, Montage, Rechnung.'::text)),
  ('reply_rules', to_jsonb('Antwort nur, wenn wirklich noetig. Bestellung/Angebotsannahme: kein Entwurf. Anfrage mit genug Angaben: kein Entwurf. Anfrage mit fehlenden Angaben (Masse, Fotos, Ort): Entwurf mit gezielten Rueckfragen. Layout freigegeben: kein Entwurf. Korrekturwunsch zum Layout: kein Entwurf. Konkrete Frage (Termin, Stand, Technik): Entwurf. Reklamation: Entwurf als Eingangsbestaetigung. Dank, Bestaetigung, reine Info: nichts.'::text)),
  ('lexoffice', '{"address": "", "forward": false}'::jsonb),
  ('budget', '{"monthly_usd": 20}'::jsonb),
  ('retention_days', '180'::jsonb),
  ('llm_prices', '{
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {"neurons_in_per_m": 26668, "neurons_out_per_m": 204805},
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": {"neurons_in_per_m": 4119, "neurons_out_per_m": 34868},
    "claude-haiku-4-5-20251001": {"usd_in_per_m": 1, "usd_out_per_m": 5, "usd_cached_in_per_m": 0.1},
    "_neuron_usd_per_1000": 0.011
  }'::jsonb)
on conflict (key) do nothing;

-- Postfach: Passwort traegt Silas im Admin-Bereich ein; solange bleibt es aus.
insert into public.email_accounts
  (label, address, imap_host, imap_port, username, shadow_mode, enabled, autopilot, folder_map)
values
  ('info@', 'info@slwerbung.de', 'imap.ionos.de', 993, 'info@slwerbung.de', true, false,
   '{
     "move_folders": "auto", "move_discard": "auto", "move_answered": "auto", "keywords": "auto",
     "log_certain": "auto", "log_assumed": "suggest", "attachments": "suggest", "draft": "auto",
     "create_project": "suggest", "prepare_offer": "suggest", "status_change": "suggest", "forward_beleg": "auto"
   }'::jsonb,
   '{}'::jsonb)
on conflict (address) do nothing;

-- KI-Anbieter: Schluessel und Account-ID kommen im Admin-Bereich dazu.
insert into public.email_ai_providers (name, type, enabled) values
  ('Cloudflare Workers AI', 'cloudflare', true),
  ('Anthropic', 'anthropic', true)
on conflict (name) do nothing;

insert into public.email_ai_settings (task, provider_id, model, fallback_provider_id, fallback_model, on_limit)
select t.task,
       (select id from public.email_ai_providers where name = t.prov),
       t.model,
       case when t.fb_model is null then null else (select id from public.email_ai_providers where name = 'Anthropic') end,
       t.fb_model,
       'ausweichen'
from (values
  ('understand',    'Cloudflare Workers AI', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'claude-haiku-4-5-20251001'),
  ('pick_project',  'Cloudflare Workers AI', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'claude-haiku-4-5-20251001'),
  ('summarize_out', 'Cloudflare Workers AI', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'claude-haiku-4-5-20251001'),
  ('draft',         'Cloudflare Workers AI', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'claude-haiku-4-5-20251001'),
  ('prepare_offer', 'Anthropic',             'claude-haiku-4-5-20251001',                null)
) as t(task, prov, model, fb_model)
on conflict (task) do nothing;

-- Systemabsender, die ohne Modell einsortiert werden. Nur Absender, bei denen
-- ein Irrtum harmlos ist (Ordner 7 „System", nichts geht verloren).
insert into public.email_rules (pattern, category, source) values
  ('@hero-software.de', 'system', 'seed'),
  ('@vercel.com', 'system', 'seed'),
  ('@supabase.io', 'system', 'seed'),
  ('@supabase.com', 'system', 'seed'),
  ('@github.com', 'system', 'seed'),
  ('@resend.com', 'system', 'seed'),
  ('@cloudflare.com', 'system', 'seed')
on conflict (pattern) do nothing;
