-- Mister X Live: lightweight realtime location-sharing mini-game.
-- Standalone from the Aufmass domain (static prototype under /mister-x-live).
-- The room code (game_id) is the shared secret players join with, so RLS is
-- intentionally open per-row rather than tied to the admin/employee/customer
-- auth model used elsewhere in this repo.

CREATE TABLE IF NOT EXISTS public.mister_x_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('detector', 'mrx')),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  last_ping TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, name)
);

CREATE INDEX IF NOT EXISTS mister_x_players_game_id_idx ON public.mister_x_players (game_id);

ALTER TABLE public.mister_x_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mister_x_players_anon_all ON public.mister_x_players;
CREATE POLICY mister_x_players_anon_all ON public.mister_x_players
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mister_x_players TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mister_x_players TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.mister_x_players;
