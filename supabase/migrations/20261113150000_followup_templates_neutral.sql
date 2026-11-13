-- Nachfass-Mails: neutral formuliert (weder Du noch Sie), Gruss immer "Beste Grüße", keine Firmennennung.
-- Die Signatur des zustaendigen Mitarbeiters haengt beim Senden automatisch an (email-send).
update public.project_followup_templates set subject = 'Angebot: {projekt}',
  body = E'Hallo,\nkurze Nachfrage zu unserem Angebot „{projekt}“ vom {angebot_datum}.\nPasst alles, oder sollen wir noch etwas anpassen?\nBeste Grüße'
 where rule_key = 'nachfassen' and stage = 1;
update public.project_followup_templates set subject = 'Freigabe: {projekt}',
  body = E'Hallo,\nkurze Nachfrage zum Layoutvorschlag für „{projekt}“: Gibt es schon eine Rückmeldung?\nSobald die Freigabe da ist, geht es los.\nBeste Grüße'
 where rule_key = 'freigabe_offen' and stage = 1;
update public.project_followup_templates set subject = 'Abholung: {projekt}',
  body = E'Hallo,\n„{projekt}“ ist fertig und liegt zur Abholung bereit.\nEine kurze Rückmeldung, wann es passt, reicht.\nBeste Grüße'
 where rule_key = 'abholung' and stage = 1;

-- Noch nicht gesendete Entwuerfe tragen den alten Text: stoppen, die Auswertung legt sie mit den neuen Vorlagen neu an.
update public.project_followup_mails set state = 'stopped', stopped_reason = 'Vorlage geändert' where state = 'draft';
