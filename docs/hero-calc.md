# hero-calc – Detailkalkulation eines HERO-Entwurfs ändern

Edge Function `hero-calc` (Rechenkern `_shared/herocalc/`). Ändert Material, Lohn, Menge und Rabatt einer
Leistung in einem **Dokument-Entwurf** (`status_code` 0) über die internen Endpunkte der HERO-Oberfläche.
Die offizielle API deckt das nicht ab. **Risiko:** `ajax_save` und die Edit-Seite sind undokumentiert.

## Aufruf
`POST /functions/v1/hero-calc`, immer HTTP 200 mit `{ ok: true, data }` oder `{ ok: false, error }`.
Pflicht: `adminToken` **oder** `employeeToken` (beides gewollt), `action`, `document_id` (= `customer_document_id`).
Schreibende Actions laufen mit `dry_run: true` als Standard; geschrieben wird nur bei `"dry_run": false`.

| action | Parameter |
|---|---|
| `get` | `include_draft?` (ohne: nur Übersicht, Summen, Positionen, `hash`) |
| `set_wage_minutes` | `position_uid` (Leistung), `wage_group_id`, `minutes` |
| `set_material` | `position_uid`, `product_id`, `quantity`, `vk_per_unit?` |
| `set_quantity` | `position_uid`, `quantity` (> 0) |
| `set_discount` | `position_uid`, genau eines von `percent` oder `amount` |
| `add_position` / `remove_position` | vollständige Position bzw. `atType` + `id` |
| `undo` | `undo_id?` (Standard: letzte Sicherung, die selbst kein Undo war) |

Antwort jeweils mit Vorher/Nachher: EK, VK, Aufschlag, Netto, MwSt., Brutto.

## Wie HERO speichert (live belegt, WER-1984)
- Lesen: GET `/partner/Documents/edit/<id>` **ohne** `X-Requested-With`, Draft unter `DocumentStore.draft`.
  Schreiben: POST `/partner/Documents/ajax_save/` mit `{draft, document:{}}`, Bearer + `X-Requested-With`.
- `data.total_price` und `draft.value` sind das **Netto**; Brutto = Netto + `data.total_vat`.
  `data.totals.vat` ist ungerundet, `data.total_vat` auf 2 Stellen. `table.totals` hat dieselben Schlüssel wie `data.totals`.
- Lohnzeile: `base_price`/`net_price_per_unit` = Stundensatz / 60, auf 4 Stellen gerundet.
- Rabatt an der Leistung: `sales` in **Prozent**. Ein Betrag wird umgerechnet (5 € auf 168 € → 2,9762).
  `net_price_per_unit` bleibt der Preis vor Rabatt, Aufschlag/Lohn-VK/Summen gelten nach Rabatt.
- Menge der Leistung: Felder an der Leistung gelten je Einheit, Tabelle/Dokument rechnen Menge × Einheit.
- `data.version` ändert sich beim Speichern nie, `modified` hat Sekundenauflösung, die Draft-`id` ändert sich bei jedem Speichern.

## Schutz
- Nur Entwürfe, Strukturprüfung vor jedem Schreiben.
- Konflikt: `modified`, `data.version` **und** SHA-256 über `data` müssen zwischen Lesen und Schreiben gleich sein.
- Sperre je Dokument (`hero_calc_lock`, 30 s): ein zweiter gleichzeitiger Schreibaufruf bricht ab.
- Vor jedem Schreiben Sicherung in `hero_calc_undo` (Draft + Hash); `undo` schreibt sie zurück (selbst gesichert und gesperrt).
- Nicht geprüfte Fälle werden **abgelehnt** (`SUPPORT` in `guard.ts`): mehrere Leistungen/Tabellen, Festpreis
  (`is_fixed_net_price`/`is_custom_price`), Rabatt bei Menge ≠ 1. Dokumentrabatt gibt es nicht. Erst freischalten, wenn
  der Fall von Hand in HERO nachgebaut und verglichen wurde.
- Nie Key in Logs/Antworten; Key bleibt in `app_config.hero_api_key`.

## Nächtlicher Vertragstest (`hero-calc-contract`)
Eigene Function, Aufruf nur mit `x-poll-secret` (= `app_config.hero_calc_poll_secret`), `{ "mode": "contract" | "selftest" }`.
Läuft **nur** gegen die Test-Entwürfe in WER-1984 (22589010 bzw. 22588702, Projekt wird geprüft), stellt sie danach exakt wieder her
und protokolliert in `hero_calc_contract_log` (`ok`, `detail.steps`). pg_cron `hero_calc_contract`, täglich 01:47 UTC.
- `contract`: lesen, `set_quantity` ändern, speichern, zurücklesen (Netto/`total_price`/`value`, `table.totals == data.totals`), rückgängig (Summen und Hash identisch).
- `selftest`: `table.totals` nach Lohnänderung auf beiden Testentwürfen, drei parallele Schreibaufrufe (genau einer läuft durch).
- **Rot = HERO hat den internen Endpoint (Edit-Seite / `ajax_save`) geändert.** Dann hero-calc nicht mehr benutzen.
- Vorbedingung am Testentwurf: genau eine Tabelle mit einer Leistung, kein Rabatt.
- Nachsehen: `select created_at, ok, detail from hero_calc_contract_log order by id desc limit 5;` (Alarmierung bei Rot gibt es noch nicht).

## Tests
- `npx vitest run supabase/functions/_shared/herocalc` (Rechenkern, Befehle, Guards, Parser)
- Offline-Ablauftests (`service.test.ts`, `contract.test.ts`) mit simuliertem HERO und simulierter DB (`testkit.ts`)
- Typprüfung: `deno check --config supabase/functions/hero-calc/deno.json supabase/functions/hero-calc/index.ts` (ebenso `hero-calc-contract`)
- `HERO_CALC_PG_URL=postgres://… scripts/test-hero-calc-lock.sh` (Sperre, Rechte, 8 parallele Aufrufe; lokales Postgres, leert die DB)
- Live nur gegen die Test-Entwürfe in WER-1984 (22588702, 22588885, 22589010).
