# Phase 0 — Sicherheits-Inventar

**Erhoben am:** 26.07.2026 gegen die Produktions-Instanz (`tocukaqhclkskpvvxmrr`).
Alle Angaben sind abgefragt, nicht geschätzt. Dieses Dokument ändert keinen Code.

---

## 0. Kurzfassung

Der in der Build-Spec beschriebene Ist-Zustand ist **teilweise überholt**. Drei
Annahmen stimmen nicht mehr, zwei Befunde sind gravierender als dort angenommen.

| Spec-Annahme | Tatsächlicher Zustand |
|---|---|
| „RLS über alle Tabellen deaktiviert" | **Falsch.** RLS ist auf allen 35 Tabellen aktiv. Die *Policies* sind bei den Betriebsdaten aber offen (`anon` mit `using(true)`) — der Effekt ist dort derselbe. |
| „Keine Auth, Anon-Key für alle Operationen" | **Teilweise falsch.** Es existiert bereits ein eigenes HMAC-Session-Token-System (Admin/Employee/Customer, 12 h) plus separater Guest-Token. Edge Functions validieren diese Tokens serverseitig. |
| „Passwörter vermutlich nicht konform gehasht" | **Falsch.** Alle 5 Mitarbeiter-Passwörter liegen als **bcrypt** vor (`$2…`), keines leer. |
| `app_config` (HERO-Key) offen | **Falsch.** Bereits per Policy gesperrt (`No direct access`). |
| Mitarbeiter „E-Mail optional" | **Falsch — schärfer.** `employees` hat **gar keine E-Mail-Spalte**. |

**Real offen bleibt** (und ist der eigentliche Handlungsbedarf):
1. `anon` darf Projekte, Standorte, Kunden, Bilder, PDFs, Freigaben **lesen, ändern und löschen**.
2. Storage-Bucket ist **public** — alle Fotos und Druckdaten sind bei bekanntem Pfad frei abrufbar.

---

## 1. Tabellen: RLS-Status und Policies

RLS ist überall aktiv. Entscheidend ist, was `anon` (= der im Frontend-Bundle
öffentlich liegende Key) darf.

### 1.1 Bereits dicht (kein Anon-Zugriff)

Diese Tabellen sind sauber — entweder per `false`-Policy oder RLS ohne Policy
(sperrt vollständig; nur `service_role` kommt durch):

| Tabelle | Mechanik | Inhalt |
|---|---|---|
| `employees` | RLS an, **0 Policies** | Namen + bcrypt-Passwort-Hashes |
| `automations`, `automation_runs` | RLS an, 0 Policies | Automationsregeln + Verlauf |
| `app_config` | `No direct access` (`false`) | **HERO-API-Key**, Konfiguration |
| `dropbox_account`, `dropbox_synced` | `no_direct_access` | Dropbox-Tokens |
| `meeting_notes` | `no_direct_access` | Protokolle + Transkripte |
| `customer_notifications` | `No direct access` | Benachrichtigungs-Status |
| `project_invites` | `no_direct_access` | Eingeladene E-Mail-Adressen |

### 1.2 Offen für `anon` — Handlungsbedarf

Alle folgenden erlauben `anon` mindestens Lesen, die meisten auch Schreiben/Löschen
(`using(true)` / `with check(true)`):

| Tabelle | Anon darf | Sensibilität |
|---|---|---|
| `projects` | SELECT, INSERT, UPDATE, DELETE | Kundennamen, Projektdaten, HERO-Verknüpfung |
| `locations` | ALL + DELETE | Standortdaten, Maße, Kommentare |
| `location_images` | ALL (2 Policies) | Fotopfade |
| `location_pdfs` | ALL (2 Policies) | Druckdatenpfade |
| `detail_images` | ALL (2 Policies) | Detailfotos |
| `customers` | SELECT, INSERT, DELETE | **Kundenstamm** |
| `customer_project_assignments` | SELECT, INSERT, DELETE | Wer sieht welches Projekt |
| `customer_uploads` | SELECT, INSERT, DELETE | Kunden-Dateien |
| `customer_location_permissions` | ALL | Sichtbarkeitsrechte |
| `location_approvals` | ALL | **Freigaben (manipulierbar)** |
| `location_feedback` | ALL | Kundenkorrespondenz |
| `floor_plans` | ALL + SELECT | Grundrisse |
| `project_layouts` | ALL (widersprüchlich, s. u.) | Layouts |
| `vehicle_*` (8 Tabellen) | ALL | Fahrzeugdaten, Layouts, Freigaben |
| `project_field_config` | SELECT, INSERT, UPDATE, DELETE | Feldkonfiguration |
| `location_field_config`, `vehicle_field_config` | SELECT | Feldkonfiguration |
| `mister_x_players` | ALL | (Spiel-Feature, unkritisch) |

**Konkreter Policy-Bug:** `project_layouts` hat gleichzeitig `no_direct_access`
(`false`) **und** `Anon manage project_layouts` (`true`). Permissive Policies
werden mit ODER verknüpft → die Tabelle ist **offen**. Die `false`-Policy
suggeriert fälschlich Schutz.

---

## 2. Storage

| Punkt | Zustand |
|---|---|
| Bucket | `project-files`, **`public = true`**, kein Size-Limit |
| Policies | `anon` darf INSERT, UPDATE, DELETE **und** SELECT auf `project-files` |
| Zugriffsform im Code | 12× `getPublicUrl()` in 5 Dateien; 5× `createSignedUrl()` |

**Bewertung:** Da der Bucket public ist, ist jede Datei ohne jeden Token abrufbar,
sobald der Pfad bekannt ist. Pfade sind vorhersagbar aufgebaut
(`vehicle-images/<projectId>/<uuid>`, `pdfs/<locationId>/…`). Zusätzlich kann
`anon` Dateien **löschen und überschreiben**.

---

## 3. Auth (Ist-Zustand)

Es gibt **kein** Supabase Auth, aber auch nicht „gar nichts":

- **Eigenes HMAC-Token-System** (`SESSION_SIGNING_SECRET`, 12 h Gültigkeit) für
  Admin / Employee / Customer, ausgestellt von `validate-admin`,
  `validate-employee`, `validate-customer`; geprüft von `validate-session` und
  in Edge Functions via `verifySessionToken()`.
- **Gast-Zugang** über separaten `guest_token` (`GUEST_TOKEN_SECRET`), zusätzlich
  `ensure-customer-assignment`, das für einen Gast einen echten Customer-Datensatz
  + Token erzeugt.
- **Mitarbeiter-Login:** Name + Passwort (bcrypt). **Keine E-Mail-Spalte vorhanden.**
- **Kunden-Login:** Name-Match (`customers` hat nur `id, name, created_at` —
  weder E-Mail noch Passwort).

**Schwachstelle:** Das Token-System schützt die *Edge Functions*, aber nicht die
*Datenbank*. Wer den Anon-Key nimmt (steht im JS-Bundle), umgeht es komplett und
spricht direkt mit PostgREST.

---

## 4. Edge Functions

29 Functions, alle `ACTIVE`. `verify_jwt` ist bei den meisten bewusst `false`,
weil sie das eigene Token-System prüfen. Sie nutzen intern `service_role`.

Bewusst öffentlich (Formulare/Gastzugang): `submit-vehicle-request`,
`submit-new-customer`, `validate-*`, `guest-data`, `update-guest-info`,
`get-view-settings`, `hero-offer-action`, `dropbox-auth`, `run-automations`.

**Auffällig:** `run-automations` ist `verify_jwt=false` und ohne Token-Prüfung
aufrufbar → Fremde könnten Automationen auslösen. Sollte in Phase 2 mit geprüft
werden.

---

## 5. Frontend-Zugriffsflächen

| Muster | Anzahl | Dateien |
|---|---|---|
| `supabase.from(...)` | **114** | 14 |
| `supabase.storage.from(...)` | 34 | — |
| `getPublicUrl` | 12 | 5 |
| `functions.invoke(...)` | 59 | — |

Schwerpunkte: `CustomerView.tsx` (34), `supabaseSync.ts` (28),
`VehicleDetail.tsx` (20), `CustomerManage.tsx` (9).

Diese 114 Stellen sind das Maß für den Umbauaufwand: Jede davon läuft heute über
den Anon-Key und müsste beim Schließen der Policies auf einen authentifizierten
Weg (Session-JWT oder Edge Function) umgestellt werden.

---

## 6. Bestandsdaten (Migrationsrelevanz)

- **5** Mitarbeiter (bcrypt, ohne E-Mail)
- **12** Kunden (ohne E-Mail/Passwort)
- **44** Projekte

Die Menge ist klein — eine Mitarbeiter-Migration ist praktisch beherrschbar.

---

## 7. Nebenbefund (Bug, unabhängig von Security)

`send-notification` liest `employees.email`, um die Completion-Mail an den
zugewiesenen Mitarbeiter zu schicken. **Diese Spalte existiert nicht.** Die
Abfrage liefert nichts, der Code fällt still auf die globale Adresse zurück. Die
Einstellung „Benachrichtigung an zugewiesenen Mitarbeiter" hat damit faktisch
keine Wirkung.

---

## 8. Folgen für die Build-Spec

1. **Phase 1 (Supabase Auth) ist teurer als angenommen.** Kein Mitarbeiter hat
   eine E-Mail-Adresse; alle 5 bräuchten Kunst-Adressen und neue Passwörter. Der
   Login würde sich für alle spürbar ändern, ohne dass sich fachlich etwas
   verbessert. → Entscheidung erforderlich (siehe unten).
2. **Phase 2 ist der eigentliche Kern.** RLS ist schon an; es fehlen nur *saubere
   Policies*. Das ist die Maßnahme mit dem größten Sicherheitsgewinn.
3. **Phase 3 (Storage) ist dringlich** und relativ isoliert umsetzbar
   (12 `getPublicUrl`-Stellen).
4. **Phase 4 ist teilweise vorhanden.** Guest-Token + `ensure-customer-assignment`
   existieren bereits; eine zweite Token-Tabelle wäre Doppelarbeit. Besser: das
   Bestehende härten (Ablauf, Widerruf, Feld-Whitelist).
5. Der `project_layouts`-Policy-Widerspruch und die ungeschützte
   `run-automations` gehören mit in Phase 2.
