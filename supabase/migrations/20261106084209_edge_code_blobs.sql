-- Uebergangsweise: gebuendelter Code fuer Edge Functions, die ohne Supabase-CLI (nur ueber das MCP-Werkzeug)
-- eingespielt wurden, weil sie fuer einen Upload zu gross waren. Ein kleiner Lader in der Function liest die
-- Teile, prueft die SHA-256 und fuehrt den Code nur bei exakter Uebereinstimmung aus.
-- Nach dem naechsten normalen `supabase functions deploy` der betroffenen Functions kann die Tabelle weg.
create table if not exists public.edge_code (
  name text not null,
  part int not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (name, part)
);
comment on table public.edge_code is 'Gebuendelter Code fuer Edge Functions, die ohne CLI deployt wurden (Lader prueft SHA-256). Nur service_role.';
alter table public.edge_code enable row level security;
revoke all on public.edge_code from anon, authenticated;
grant all on public.edge_code to service_role;
