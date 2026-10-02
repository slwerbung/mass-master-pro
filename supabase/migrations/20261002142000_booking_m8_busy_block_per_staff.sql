-- M8 — ein HERO-Termin darf mehrere Mitarbeiter blockieren.
--
-- M1 hatte `busy_block_source_ref_uidx` auf (source, source_ref) gelegt: pro
-- Quell-ID genau eine Zeile. M4 brauchte dann eine Zeile PRO MITARBEITER und
-- legte `busy_block_source_ref_staff_uidx` auf (source, source_ref, staff_id)
-- dazu — nur blieb der alte Index liegen.
--
-- Folge im Betrieb: sobald ein HERO-Termin zwei zugeordnete Mitarbeiter hatte,
-- scheiterte der Upsert des ganzen Laufs mit
-- "duplicate key value violates unique constraint busy_block_source_ref_uidx".
-- Der Lauf brach ab, es wurde KEIN einziger HERO-Block geschrieben, und die
-- Terminsuche bot Zeiten an, die in der Plantafel längst belegt waren. Genau
-- so passiert (14:00 doppelt vergeben, 02.10.2026).
--
-- Der Fehler blieb unsichtbar, weil `booking-hero-sync` Fehler als HTTP 200
-- mit Fehlertext zurückgibt (damit pg_cron-Läufe auswertbar bleiben) — im
-- Edge-Log sah jeder Lauf erfolgreich aus.

drop index if exists public.busy_block_source_ref_uidx;
