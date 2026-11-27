-- hero-calc: Alarm bei rotem Nachttest, höchstens eine Meldung je 24 h (Drosselung über diese Spalte).
alter table public.hero_calc_contract_log add column if not exists alerted boolean not null default false;
