-- Dropbox-Poller: harter ID-Wasserstand als strukturelle Garantie.
--
-- Bisher entschied allein die Merk-Tabelle dropbox_synced, was "neu" ist.
-- War dieser Abgleich je unvollständig (z.B. durch das 1000-Zeilen-Limit),
-- galten Bestandskunden/-projekte fälschlich als neu und wurden erneut
-- verarbeitet.
--
-- Der Wasserstand macht das unmöglich: HERO vergibt fortlaufende, aufsteigende
-- IDs. Beim Einrichten merken wir die höchste vorhandene Projekt-/Kunden-ID.
-- Danach gilt AUSSCHLIESSLICH etwas mit einer ID OBERHALB des Wasserstands als
-- Kandidat. Alles, was zum Einrichtungszeitpunkt existierte, kann damit per
-- Konstruktion nie wieder auslösen - egal in welchem Zustand dropbox_synced ist.
--
-- Leer (NULL) = noch nicht gesetzt. Der Poller initialisiert den Wasserstand
-- beim nächsten Lauf auf den aktuellen HERO-Höchststand und feuert dabei nichts.
INSERT INTO public.app_config (key, value) VALUES
  ('dropbox_watermark_project_id',  ''),
  ('dropbox_watermark_customer_id', '')
ON CONFLICT (key) DO NOTHING;
