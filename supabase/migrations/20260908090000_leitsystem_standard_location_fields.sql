-- Standard-Standortfelder fuer Projekte vom Typ "Aufmass mit Plan"
--
-- Die Standortfelder bleiben wie bisher frei konfigurierbar (Admin →
-- Standortfelder). Diese Migration legt lediglich ein paar Felder an, die bei
-- einem Leitsystem praktisch immer gebraucht werden – damit niemand sie bei
-- jedem Projekt von Hand nachbauen muss.
--
-- Alle Felder tragen `applies_to = 'aufmass_mit_plan'`. Bei normalen
-- Aufmassen und bei Fahrzeugbeschriftungen aendert sich dadurch nichts:
-- LocationDetails filtert die Felder bereits nach dem Projekttyp.
--
-- Der Schluessel-Praefix `custom_` ist Pflicht – nur so landen die Werte in
-- `locations.custom_fields` (siehe LocationDetails: Object.entries(...)
-- .filter(([k]) => k.startsWith('custom_'))).
--
-- Idempotent: laeuft die Migration zweimal, entstehen keine Dubletten. Wer
-- ein Feld nicht braucht, schaltet es im Admin inaktiv oder loescht es –
-- die Migration legt es nicht erneut an, solange der Schluessel existiert.

do $$
declare
  eintrag record;
  felder constant jsonb := '[
    {"key": "custom_gebaeude",   "label": "Gebäude",     "type": "text",     "sort": 50, "options": null},
    {"key": "custom_geschoss",   "label": "Geschoss",    "type": "text",     "sort": 51, "options": null},
    {"key": "custom_schildtyp",  "label": "Schildtyp",   "type": "text",     "sort": 52, "options": null},
    {"key": "custom_menge",      "label": "Menge",       "type": "text",     "sort": 53, "options": null},
    {"key": "custom_montageart", "label": "Montageart",  "type": "dropdown", "sort": 54,
     "options": ["Wandmontage", "Deckenabhängung", "Klebemontage", "Bodenmontage", "Pfostenmontage", "Sonstige"]},
    {"key": "custom_status",     "label": "Status",      "type": "dropdown", "sort": 55,
     "options": ["Geplant", "Freigegeben", "Bestellt", "Produziert", "Montiert", "Abgenommen", "Entfallen"]}
  ]'::jsonb;
begin
  for eintrag in select * from jsonb_array_elements(felder) as f(wert) loop
    if not exists (
      select 1 from public.location_field_config
      where field_key = eintrag.wert->>'key'
    ) then
      insert into public.location_field_config
        (field_key, field_label, field_type, field_options, sort_order,
         is_active, customer_visible, applies_to, is_required)
      values (
        eintrag.wert->>'key',
        eintrag.wert->>'label',
        eintrag.wert->>'type',
        case when eintrag.wert->'options' = 'null'::jsonb
             then null
             else (eintrag.wert->'options')::text
        end,
        (eintrag.wert->>'sort')::int,
        true,
        true,
        'aufmass_mit_plan',
        false
      );
    end if;
  end loop;
end $$;
