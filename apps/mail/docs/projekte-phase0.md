# Projekte – Phase 0: Technik-Check (Zwischenstand 12.11.2026)

Nur lesende Prüfungen gegen HERO und Supabase. Schreibende Tests (Logbuch, Statuswechsel hin und zurück) brauchen ein Testprojekt – **offen**.

## Beantwortet

| Frage | Ergebnis |
| --- | --- |
| `step_id` bei `update_project_match` | Gehört in `current_project_match_status: { step_id }` (ein `step_id` auf oberster Ebene ignoriert HERO beim Ändern, siehe `setStep` in `_shared/email/hero.ts`, SQL `hero_set_step`). In allen 50 geprüften Projekten gilt `current_project_match_status.step_id == step.id`, es gibt also nur eine ID-Art. Schreibende Gegenprobe steht noch aus. |
| Status-IDs | 2825 Anfragen, 2834 Warten auf Bezahlung, 2836 Abgeschlossen, 266511 Angeboterstellung, 266512 Projektplanung, 266646 Fertig zur Abholung, 266648 Warten auf Auftrag, 266740 Materialbestellung, 266741 Warten auf Ware / Daten. Archiviert (2837 laut Doku) ist in der Stichprobe nicht vorgekommen, die Namen tragen Emoji. Vollständige Liste kommt aus dem Sync (`project_step_settings`). |
| Direktlink Projekt | `https://login.hero-software.de/partner/Projects/view/<project_match.id>` (`HeroLink.tsx`). Dokumentlink: offen. |
| Mitarbeiter-Zuordnung | `employees.email` existiert (5 Mitarbeiter, alle mit Profil). `project_match_assignments.user.email` enthält **Dubletten** (z. B. dieselbe Adresse zweimal) → beim Sync deduplizieren. `info@slwerbung.de` ist Standardzuweisung, kein Bearbeiter. |
| `project_matches` | Liefert neueste zuerst; `id` ist die Match-ID (z. B. 12777185 = WER-1971). |

## Offen

- [ ] Schreibender Test an einem Testprojekt: Logbuch-Eintrag, Statuswechsel hin und zurück.
- [ ] Kalendertermine lesen (Top-Level-Query), `CalendarEventInput` mit Mitarbeiter/Kategorie (`category_id` ist Pflicht, `partner_ids` für Mitarbeiter laut `booking-api`).
- [ ] `create_document` mit Positionen; AB aus Angebot per API.
- [ ] Telefonnummer und E-Mail des Projektkontakts.
- [ ] Dokument-Direktlink.

## Abweichungen von der Spec

- `_shared/hero.ts` gibt es nicht; der HERO-Client liegt in `supabase/functions/_shared/email/hero.ts` (genutzt von email-action, email-api, email-draft, email-process, booking-*).
- `spec-captfix-okt-2026.md` liegt nicht im Repo; CaptFix A–E ist laut Git-Verlauf und `CLAUDE.md` umgesetzt.
- `hero_set_step()` existiert nur live in der DB, nicht in `supabase/migrations/`.

## Entscheidung (12.11.2026)

Logbuch, Statuswechsel, Termine (`category_id`, `partner_ids`) und `create_document` laufen schon produktiv in `email-action`/`heroOps.ts`/`booking-api`. Ein eigener Schreibtest an einem Testprojekt entfällt. Offen bleibt nur, was Phase 3/4 braucht (Telefonnummer des Kontakts, Dokument-Direktlink, AB aus Angebot per API) – wird dort geprüft.
