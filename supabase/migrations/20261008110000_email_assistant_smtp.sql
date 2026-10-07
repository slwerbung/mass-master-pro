-- KI-Mail-Assistent: SMTP-Zugang NUR fuer die automatische Weiterleitung von Belegen an die Lexware-Belegadresse.
-- Port 465 (implizites TLS); 25 und 587 sind aus Supabase Edge Functions gesperrt. Benutzer und Passwort sind die des Postfachs.
alter table public.email_accounts
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer not null default 465;

update public.email_accounts set smtp_host = 'smtp.ionos.de' where smtp_host is null and imap_host = 'imap.ionos.de';
