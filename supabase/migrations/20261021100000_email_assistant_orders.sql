-- KI-Mail-Assistent: Bestellung -> Projekt + Auftragsbestaetigung (AB) -> Pruefen -> Versand ueber HERO,
-- und Referenzwissen (Skill-Dateien, HERO-Doku) fuer die KI. Siehe docs/mail-assistent/betrieb.md.

-- ---------------------------------------------------------------------------
-- Neue Vorschlagsarten
-- ---------------------------------------------------------------------------
alter table public.email_suggestions drop constraint if exists email_suggestions_type_check;
alter table public.email_suggestions add constraint email_suggestions_type_check
  check (type in ('create_project', 'link_project', 'log_entry', 'upload_attachments', 'prepare_offer', 'change_step',
                  'create_confirmation', 'send_document'));

-- ---------------------------------------------------------------------------
-- Neue KI-Aufgabe: Positionen fuer die AB aus frueheren ABs/Angeboten waehlen
-- ---------------------------------------------------------------------------
alter table public.email_ai_settings drop constraint if exists email_ai_settings_task_check;
alter table public.email_ai_settings add constraint email_ai_settings_task_check
  check (task in ('understand', 'pick_project', 'summarize_out', 'draft', 'prepare_offer', 'prepare_confirmation'));

insert into public.email_ai_settings (task, provider_id, model, fallback_provider_id, fallback_model, shadow_provider_id, shadow_model, on_limit, daily_neuron_limit)
select 'prepare_confirmation', provider_id, model, fallback_provider_id, fallback_model, null, null, on_limit, daily_neuron_limit
from public.email_ai_settings where task = 'prepare_offer'
on conflict (task) do nothing;

-- ---------------------------------------------------------------------------
-- Referenzwissen: laengere Dokumente (Skill-Dateien, HERO-Doku), die die KI bei
-- bestimmten Aufgaben mitliest. Pflege in der Mail-App (Einstellungen -> Referenzwissen).
-- Keine Kundennamen/Adressen hineinschreiben.
-- ---------------------------------------------------------------------------
create table if not exists public.email_reference_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 200),
  content text not null default '' check (char_length(content) <= 60000),
  -- Aufgaben, bei denen die KI das Dokument liest: prepare_offer, prepare_confirmation, understand, draft
  tasks text[] not null default '{prepare_offer,prepare_confirmation}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_reference_docs enable row level security;
revoke all on public.email_reference_docs from anon, authenticated;
grant all on public.email_reference_docs to service_role;

-- Startbestand: was aus dem HERO-Skill schon vorliegt (ohne Personen- und Kundendaten).
insert into public.email_reference_docs (title, content, tasks, active)
select * from (values
(
  'HERO bei SL WERBUNG – Grundlagen',
  $doc$# HERO bei SL WERBUNG (Stand 09/2026)

HERO ist das zentrale System: Kunden (CRM), Projektpipeline, Angebote/ABs/Rechnungen, Kalender, Logbuch, E-Mail-Vorlagen.

## Dokumentkette
Angebot -> Auftragsbestätigung (AB) -> Rechnung. Folgedokumente übernehmen die Positionen des Vorgängers.
Dokumenttypen: Angebot 171300, Auftragsbestätigung 171301, Rechnung 171302, Lieferschein 171307, Plan/Layout 338164, Druckdaten 428979.
Status eines Dokuments: 0 Entwurf (noch kein PDF) · 100 Erstellt (PDF da, noch nicht versendet) · 200 Versendet.

## Positionen
- Positionen sind Artikel/Leistungen aus dem HERO-Stamm (mit Artikelnummer, Einheit, Netto-Einzelpreis, 19 % MwSt.) oder Zwischentitel.
- Typische Positionen: Grafik (Std), Druckdatenerstellung (Std), Digitaldruck auf Rollenmaterial, Entschriften/Neutralisieren (Std), Fahrzeugpauschale bis 10 km, Paketversand.
- Preise kommen IMMER aus HERO (Stammdaten oder frühere Dokumente des Kunden). Nie Preise erfinden oder schätzen.

## Auftragsbestätigung (AB)
- Kommt eine Bestellung, ist die Grundlage fast immer eine frühere AB desselben Kunden (Nachbestellung) oder das Angebot im Projekt.
- Positionen und Preise werden aus dieser Vorlage übernommen, nur die Mengen ändern sich laut Bestellung.
- Was sich keiner früheren Position zuordnen lässt, wird NICHT erfunden, sondern als offener Punkt gemeldet.
- Versand: E-Mail-Vorlage „Auftragsbestätigung verschicken“ (PER SIE / PER DU – Anrede passend zum Kunden), mit dem AB-PDF.

## Projektpipeline (Typ PROJEKT)
Anfragen -> Vor-Ort-Termin -> Angeboterstellung -> Warten auf Auftrag -> Detailgespräch -> Projektplanung -> Visualisierung/Layout
-> Warten auf Layoutfreigabe -> Materialbestellung -> Warten auf Ware/Daten -> Produktionsdaten -> Druck -> Plott/Schnitt -> Endproduktion
-> Fertig zur Montage/Fahrzeugbeschriftung/Abholung/Versand -> Fertig zur Abrechnung -> Warten auf Bezahlung -> Abgeschlossen.
Nach einer Bestellung geht es meist nach „Detailgespräch“ oder direkt „Projektplanung“.

## Gewerke
Werbetechnik (Kürzel WER, Projektnummern WER-1234), Textildruck.
$doc$,
  array['prepare_offer', 'prepare_confirmation', 'understand', 'draft'],
  true
),
(
  'Angebotserstellung (Skill hero-angebote)',
  $doc$Hier den Inhalt der Skill-Datei zur Angebotserstellung einfügen (Angebot_SKILL.md bzw. Skill „hero-angebote“):
Leistungen, Rezepturen, Materialien, Montage, Fahrzeugpauschale, Kalkulationsregeln – und was davon für Auftragsbestätigungen gilt.
Solange hier nur dieser Platzhalter steht, ist das Dokument ausgeschaltet.$doc$,
  array['prepare_offer', 'prepare_confirmation'],
  false
)) as v(title, content, tasks, active)
where not exists (select 1 from public.email_reference_docs);

-- Dokumenttyp „Auftragsbestätigung" in die HERO-Konfiguration (Einstellungen -> Firma & HERO; „HERO neu laden" findet ihn auch).
update public.email_config
set value = value || '{"confirmation_document_type_id": 171301}'::jsonb, updated_at = now()
where key = 'hero' and jsonb_typeof(value) = 'object' and not (value ? 'confirmation_document_type_id');
