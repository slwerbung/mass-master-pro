# hero-calc – Detailkalkulation eines HERO-Entwurfs ändern

Edge Function `hero-calc` (Rechenkern `_shared/herocalc/`). Ändert Material, Lohn, Menge und Rabatt einer
Leistung in einem **Dokument-Entwurf** (`status_code` 0) über die internen Endpunkte der HERO-Oberfläche.
Die offizielle API deckt das nicht ab. **Risiko:** `ajax_save` und die Edit-Seite sind undokumentiert.

## Aufruf
`POST /functions/v1/hero-calc`, immer HTTP 200 mit `{ ok: true, data }` oder `{ ok: false, error }`.
Pflicht: `adminToken` **oder** `employeeToken` **oder** `teamKey` (Tabelle `hero_team_keys`, nur der SHA-256-Hash liegt dort; Aufrufer im Protokoll `key:<id>`),
`action`, `document_id` (= `customer_document_id`; nur `lookup_product` braucht keine).
Schreibende Actions laufen mit `dry_run: true` als Standard; geschrieben wird nur bei `"dry_run": false`.

| action | Parameter |
|---|---|
| `get` | `include_draft?` (ohne: nur Übersicht, Summen, Positionen, `hash`) |
| `lookup_product` | `search` (mind. 2 Zeichen, Name oder Artikelnummer; ohne `document_id`) → `nr`, `name`, EK, `product_id` |
| `replace_material` | `position_uid`, `product_id` (alte Zeile), `new_nr` (Artikelnummer, exakt), `vk_per_unit?` – Menge und VK-Aufschlag der alten Zeile bleiben |
| `recalc` | `position_uid` entfällt; rechnet alle Summen neu (z. B. nach `create_document`) |
| `set_wage_minutes` | `position_uid` (Leistung), `wage_group_id`, `minutes`; bei doppelter Lohngruppe zusätzlich `activity` oder `index` |
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
- EK je Leistung = Summe der Zeilen **abgeschnitten** auf 4 Stellen, Lohn-EK auf 2 Stellen, Material-EK = EK − Lohn-EK.
- **Rabatt bei Menge > 1 (live belegt):** er gilt auf die **Gesamtsumme**: brutto = round2(VK je Einheit × Menge), Rabatt = round2(brutto × %),
  Netto = brutto − Rabatt. Beispiel: Menge 2, 7 % → Rabatt 28,97 (Dokument-Netto 596,21 mit einer zweiten Leistung).
- **Eigener Preis** (`is_custom_price`, in HERO „VK Netto neu“, live belegt 27.11.): VK je Einheit = `custom_material_price` + `custom_wage_price`,
  die Zeilen-VK zählen nicht; EK, Zeiten und Zeilenwerte bleiben. Rabatt und Menge danach wie gewohnt. Beispiel: 100 + 50,50, Menge 2, 10 % → brutto 301,00,
  Rabatt 30,10, **Netto 270,90**. Fehlen die beiden Felder, wird abgelehnt.
- Titel und Textbausteine (`type` `title`/`text`) in der Tabelle haben keine Summen und werden übersprungen.
- **Bereinigung bei jedem Schreiben** (`sanitizePositions` in `ops.ts`): Materialzeilen mit `attributes` null/fehlend bekommen die Standardform,
  `file_upload_uuid: ""` wird `null`. Sonst lehnt der HERO-Editor mit „Document schema validation failed“ ab (kommt von aus anderen Entwürfen kopierten Zeilen).
  Materialzeilen ohne `uid` werden vor dem Schreiben abgelehnt (HERO: 422 „uid is empty“).
- Speichern wird **geprüft**: HERO legt manchmal einen neuen Entwurfs-Datensatz an (Draft-`id` ändert sich) und ignoriert dann ein Speichern mit der alten `id`.
  Darum nach dem Speichern neu lesen, bei Abweichung einmal mit der aktuellen `id` wiederholen, sonst automatisch auf den Stand davor zurück.
- `data.version` ändert sich beim Speichern nie, `modified` hat Sekundenauflösung, die Draft-`id` ändert sich bei jedem Speichern.

## Schutz
- Nur Entwürfe, Strukturprüfung vor jedem Schreiben.
- Konflikt: `modified`, `data.version` **und** SHA-256 über `data` müssen zwischen Lesen und Schreiben gleich sein.
- Sperre je Dokument (`hero_calc_lock`, 30 s): ein zweiter gleichzeitiger Schreibaufruf bricht ab.
- Vor jedem Schreiben Sicherung in `hero_calc_undo` (Draft + Hash); `undo` schreibt sie zurück (selbst gesichert und gesperrt).
- Freigabe in `guard.ts` (`SUPPORT`): `multipleServices: true`, `customPrice: true` (beide live belegt), **`fixedPrice: false`** –
  Festpreis (`is_fixed_net_price`) wird **abgelehnt** („Festpreis … nicht unterstützt“), Bedeutung und Rechenweg sind nicht belegt.
  Dokumentrabatt gibt es nicht. Erst freischalten, wenn der Fall von Hand in HERO nachgebaut und verglichen wurde.
- Nie Key in Logs/Antworten; Key bleibt in `app_config.hero_api_key`.

## Nächtlicher Vertragstest (`hero-calc-contract`)
Eigene Function, Aufruf nur mit `x-poll-secret` (= `app_config.hero_calc_poll_secret`), `{ "mode": "contract" | "selftest" }`.
Läuft **nur** gegen die Test-Entwürfe in WER-1984 (22589010 bzw. 22588702, Projekt wird geprüft), stellt sie danach exakt wieder her
und protokolliert in `hero_calc_contract_log` (`ok`, `detail.steps`). pg_cron `hero_calc_contract`, täglich 01:47 UTC.
- `contract`: lesen, `set_quantity` ändern, speichern, zurücklesen (Netto/`total_price`/`value`, `table.totals == data.totals`), rückgängig (Summen und Hash identisch),
  danach **`runPureChecks`** (nur im Speicher, schreibt nichts): eigener Preis 100 + 50,50 / Menge 2 / 10 % → 270,90, Festpreis abgelehnt, eigener Preis ohne Werte abgelehnt,
  Bereinigung (`attributes`, `file_upload_uuid`), `recalc` ohne Änderung = von HERO gespeicherte Summen.
- `selftest`: `table.totals` nach Lohnänderung auf beiden Testentwürfen, drei parallele Schreibaufrufe (genau einer läuft durch).
- **Rot = HERO hat den internen Endpoint (Edit-Seite / `ajax_save`) geändert.** Dann hero-calc nicht mehr benutzen.
- Vorbedingung am Testentwurf: genau eine Tabelle mit einer Leistung, kein Rabatt.
- Alarm bei Rot (nur Modus `contract`): Push an die Admin-Geräte der Mail-App und Mail an info@slwerbung.de, höchstens einmal je 24 h (`alert.ts`). Ein Offer-Testmodus existiert nicht mehr.
- Nachsehen: `select created_at, ok, detail from hero_calc_contract_log order by id desc limit 5;`

## Tests
- `npx vitest run supabase/functions/_shared/herocalc` (Rechenkern, Befehle, Guards, Parser)
- Offline-Ablauftests (`service.test.ts`, `contract.test.ts`) mit simuliertem HERO und simulierter DB (`testkit.ts`)
- Typprüfung: `deno check --config supabase/functions/hero-calc/deno.json supabase/functions/hero-calc/index.ts` (ebenso `hero-calc-contract`)
- `HERO_CALC_PG_URL=postgres://… scripts/test-hero-calc-lock.sh` (Sperre, Rechte, 8 parallele Aufrufe; lokales Postgres, leert die DB)
- Live nur gegen die Test-Entwürfe in WER-1984 (22588702, 22588885, 22589010).

## hero-offer (Angebots- und Rechnungsentwurf)
Eigene Function `hero-offer` (`_shared/herooffer/offer.ts`, `invoice.ts`), gleiche Auth wie `hero-calc` (`teamKey` oder Admin-/Mitarbeiter-Token). Immer HTTP 200 `{ ok, data | error }`, `dry_run` ist Standard.
- `find_project`, `find_service`, `get_service`: lesen.
- `create_catalog_service { name, unit_type?, description?, products:[{id,quantity}], wages:[{id,minutes}], dry_run? }`: neue Katalogleistung, Dublettenprüfung per Name (Silas, 26.11.: ohne Freigabe).
- `create_offer { project_nr, services:[{ section?, catalog_service_id, quantity?, quantity_overrides? }], titles?, dry_run? }`: Angebots-Entwurf (171300). Katalogleistungen werden **verknüpft**
  (`add_existing_service`), Titel PROJEKTIERUNG/PRODUKTION/MONTAGE automatisch (`titles:false` schaltet ab). Freie Leistung nur mit `allow_unlinked: true`.
  Danach `quantity_overrides` per `set_material`/`set_wage_minutes` und `recalc`. Neue Dokument-ID = Vorher/Nachher der Projektentwürfe; nicht genau ein neuer Entwurf = Abbruch.
- `create_invoice_draft { project_nr, offer_document_id, service_uids?, dry_run? }`: Rechnungs-Entwurf (171302) aus einem **abgeschlossenen** Angebot (aus einem Entwurfs-Angebot lehnt HERO ab).
  Alle Leistungen = Schlussrechnung, `service_uids` = Teilrechnung. Nach dem Anlegen werden die Summen nur gelesen und mit dem Angebot verglichen.
- Nie abschließen, nie versenden. Jedes Anlegen steht in `hero_offer_log` (`caller`, `command`, `project_nr`, `project_match_id`, `document_id`, `ok`, `result` jsonb).

## Repo = Live-Stand
Live-Code in Supabase ist die Wahrheit; das Repo wird daraus gepflegt. `_shared/herocalc/live-manifest.json` hält die SHA-256 aller live ausgelieferten Dateien
(hero-calc v18, hero-offer v12, hero-calc-contract v4); `live-sync.test.ts` schlägt bei jeder Abweichung an und prüft, dass `service/ops/calc/guard/overview/parse` in allen drei
Functions identisch sind (im Repo nur einmal vorhanden, live trägt jede Function eine Kopie). `_shared/session.ts` ist ausgenommen (live gekürzte Fassung).
**Vor jedem Deploy** alle Dateien einer Function mitsenden und danach Manifest bewusst nachziehen; nie aus einem veralteten Stand deployen.
