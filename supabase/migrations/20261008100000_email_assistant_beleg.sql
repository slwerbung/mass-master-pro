-- KI-Mail-Assistent: Belege und Portal-Rechnungen.
--
-- Mails, bei denen die Rechnung nur im Kundenportal des Anbieters liegt (z. B. Aral), landen im Ordner
-- „8 Belege abholen (Portal)“ und stehen in der Mail-App auf der Liste „Im Portal abzuholen“.
-- `beleg_state` ist zugleich die Warteschlange fuer eine spaetere Automatisierung per Browser.

alter table public.email_messages
  add column if not exists beleg_state text
    check (beleg_state in ('weiterleiten_offen', 'weitergeleitet', 'portal_offen', 'portal_erledigt')),
  add column if not exists beleg_vendor text,
  add column if not exists forwarded_at timestamptz;

create index if not exists email_messages_beleg_idx on public.email_messages (beleg_state) where beleg_state is not null;
