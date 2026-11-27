-- Undo-Sicherung für hero-calc: vor jedem Schreiben wird der alte HERO-Draft abgelegt.
-- Nur service_role (RLS an, keine Policy, kein Grant für anon/authenticated).
CREATE TABLE IF NOT EXISTS public.hero_calc_undo (
  id          bigserial PRIMARY KEY,
  document_id bigint      NOT NULL,
  draft_id    bigint,
  draft_json  jsonb       NOT NULL,
  command     text        NOT NULL,
  caller      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hero_calc_undo_doc_idx ON public.hero_calc_undo (document_id, created_at DESC);
ALTER TABLE public.hero_calc_undo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hero_calc_undo FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.hero_calc_undo_id_seq FROM anon, authenticated;
