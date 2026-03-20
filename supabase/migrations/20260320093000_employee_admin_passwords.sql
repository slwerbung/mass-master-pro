alter table public.employees
add column if not exists password_hash text;
