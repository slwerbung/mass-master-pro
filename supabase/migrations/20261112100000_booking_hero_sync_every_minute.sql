-- HERO-Abgleich der Terminbuchung jede Minute statt alle 10 Minuten.
--
-- Ein in der HERO-Plantafel angelegter oder verlaengerter Termin war bis zu
-- 10 Minuten lang noch buchbar. Der Lauf ist klein (zwei GraphQL-Abfragen,
-- Antwort unter einer Sekunde), jede Minute ist also unbedenklich.
-- Zusaetzlich gleicht `booking-api` beim Buchen den Tag des Mitarbeiters live
-- ab (`_shared/booking/hero-live.ts`).
--
-- Live bereits am 12.11.2026 per cron.alter_job umgestellt; diese Migration
-- haelt den Stand im Repo fest.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'booking-hero-sync'),
  schedule := '* * * * *'
);
