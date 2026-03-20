alter table public.employees
add column if not exists password_hash text;

-- optional legacy cleanup: global employee password remains only as fallback until functions are deployed
-- admin password can now be stored hashed in app_config under key 'admin_password_hash'
