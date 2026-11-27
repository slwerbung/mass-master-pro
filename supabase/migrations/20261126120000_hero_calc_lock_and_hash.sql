-- hero-calc Nachbesserung: Hash an der Undo-Sicherung und Sperre je Dokument.
ALTER TABLE public.hero_calc_undo ADD COLUMN IF NOT EXISTS draft_hash text;

-- Sperre je document_id; verfällt von selbst (locked_until). Nur service_role.
CREATE TABLE IF NOT EXISTS public.hero_calc_lock (
  document_id  bigint PRIMARY KEY,
  locked_until timestamptz NOT NULL
);
ALTER TABLE public.hero_calc_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hero_calc_lock FROM anon, authenticated;

-- Atomar: true = Sperre erhalten, false = Entwurf wird gerade bearbeitet.
CREATE OR REPLACE FUNCTION public.hero_calc_acquire_lock(p_document_id bigint, p_seconds integer DEFAULT 30)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE got boolean;
BEGIN
  INSERT INTO public.hero_calc_lock AS l (document_id, locked_until)
  VALUES (p_document_id, now() + make_interval(secs => p_seconds))
  ON CONFLICT (document_id) DO UPDATE SET locked_until = EXCLUDED.locked_until
    WHERE l.locked_until < now()
  RETURNING true INTO got;
  RETURN COALESCE(got, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.hero_calc_release_lock(p_document_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ DELETE FROM public.hero_calc_lock WHERE document_id = p_document_id; $$;

REVOKE ALL ON FUNCTION public.hero_calc_acquire_lock(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hero_calc_release_lock(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hero_calc_acquire_lock(bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.hero_calc_release_lock(bigint) TO service_role;
