-- Dropbox-Integration: Verbindungsdaten, Polling-Dedupe und Einstellungen.
--
-- Wenn in HERO ein neues Projekt/ein neuer Kunde angelegt wird, legt ein
-- geplanter Poller (hero-dropbox-poll) automatisch die passenden Ordner in
-- der Firmen-Dropbox an (Basis-Pfad -> Kundenordner -> Projektordner +
-- konfigurierbare Unterordner-Vorlage).

-- Sensible Verbindungsdaten (App-Credentials + OAuth-Tokens). Einzeiler.
-- Nur Service-Role (Edge Functions), kein direkter Client-Zugriff.
CREATE TABLE IF NOT EXISTS public.dropbox_account (
  id                       int PRIMARY KEY DEFAULT 1,
  app_key                  text,
  app_secret               text,
  refresh_token            text,
  access_token             text,
  access_token_expires_at  timestamptz,
  account_name             text,
  connected_at             timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dropbox_account_singleton CHECK (id = 1)
);
ALTER TABLE public.dropbox_account ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access_dropbox_account" ON public.dropbox_account;
CREATE POLICY "no_direct_access_dropbox_account" ON public.dropbox_account USING (false) WITH CHECK (false);

-- Welche HERO-Entitäten wir schon zu Dropbox-Ordnern gemacht haben. Verhindert
-- doppelte Ordner und lässt den Poller nur NEUE Einträge erkennen.
CREATE TABLE IF NOT EXISTS public.dropbox_synced (
  kind         text   NOT NULL,   -- 'project' | 'customer'
  hero_id      bigint NOT NULL,
  dropbox_path text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, hero_id)
);
ALTER TABLE public.dropbox_synced ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access_dropbox_synced" ON public.dropbox_synced;
CREATE POLICY "no_direct_access_dropbox_synced" ON public.dropbox_synced USING (false) WITH CHECK (false);

-- Nicht-sensible Einstellungen liegen in app_config (Service-Role lesen,
-- Admin verwaltet via admin-manage). Defaults setzen.
INSERT INTO public.app_config (key, value) VALUES
  ('dropbox_enabled',            'false'),
  ('dropbox_base_path',          '/Geschäftliches/Kunden'),
  ('dropbox_customer_pattern',   '{kunde}'),
  ('dropbox_project_pattern',    '{projektnr} {projektname}'),
  ('dropbox_project_subfolders', E'01 Aufmaß\n02 Layout\n03 Freigaben\n04 Produktion\n05 Montage\n06 Angebot + Rechnung'),
  ('dropbox_poll_baseline_done', 'false')
ON CONFLICT (key) DO NOTHING;
