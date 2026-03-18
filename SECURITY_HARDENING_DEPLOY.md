# Security-Härtung sauber deployen

Diese Version enthält Frontend **und** Supabase-Backend-Code für den gehärteten Admin-/Mitarbeiter-Login.

Wichtig: **Ein Git-Push allein deployed die Supabase Edge Functions und Secrets normalerweise nicht automatisch.**
Wenn nur das Frontend live ist, aber die neuen Functions/Secrets nicht, entsteht genau der Mischzustand, der vorher den Login gebrochen hat.

## Was zusätzlich zum Git-Push nötig ist

### 1. Migrationen in die Datenbank bringen

```bash
supabase db push
```

Alternativ kannst du die enthaltenen SQL-Migrationen auch manuell im Supabase SQL Editor ausführen.

Relevant für diesen Stand sind insbesondere:
- `supabase/migrations/20260318000000_floor_plans_sync.sql`
- `supabase/migrations/20260318110000_customer_visibility_and_feedback.sql`
- `supabase/migrations/20260318123000_security_hardening_auth_and_field_config.sql`

### 2. Edge Functions deployen

```bash
supabase functions deploy validate-admin
supabase functions deploy validate-employee
supabase functions deploy validate-session
supabase functions deploy admin-manage
supabase functions deploy ensure-customer-assignment
supabase functions deploy customer-data
supabase functions deploy guest-data
supabase functions deploy validate-guest
supabase functions deploy update-guest-info
supabase functions deploy send-notification
```

Wenn du es gesammelt machst:

```bash
supabase functions deploy validate-admin validate-employee validate-session admin-manage ensure-customer-assignment customer-data guest-data validate-guest update-guest-info send-notification
```

### 3. Secrets setzen

Für die neue Session-Absicherung brauchst du mindestens diese Secrets:

```bash
supabase secrets set ADMIN_PASSWORD='DEIN_ADMIN_PASSWORT'
supabase secrets set SESSION_SIGNING_SECRET='EIN_LANGES_ZUFÄLLIGES_SECRET'
```

Hinweis:
- `SESSION_SIGNING_SECRET` sollte **nicht** einfach das Admin-Passwort sein.
- Nimm dafür ein langes zufälliges Secret.

### 4. Projekt neu deployen / Frontend aktualisieren

Danach normal euer Frontend neu deployen.

## Prüfen ob alles sauber live ist

### Admin-Login
- richtiges Admin-Passwort funktioniert
- falsches Admin-Passwort wird abgelehnt

### Mitarbeiter-Login
- Mitarbeiter ohne Passwort: direkter Login
- Mitarbeiter mit gesetztem Passwort: Login nach Passworteingabe

### Admin-Bereich
- Mitarbeiter-Passwort setzen funktioniert
- Feldkonfiguration anlegen/ändern/löschen funktioniert

## Wenn du nur SQL ausführen kannst

Dann gilt:
- **SQL allein reicht für diese Härtung nicht aus**, weil der entscheidende Teil in den Edge Functions steckt.
- Du brauchst zusätzlich den Supabase CLI Deploy der Functions **oder** musst die Functions im Supabase Dashboard aktualisieren.

## Warum das nötig ist

Die Security-Härtung verschiebt kritische Prüfungen von:
- Browser / localStorage

nach:
- Edge Functions mit signierten Sitzungen

Darum müssen Frontend, Migrationen, Functions und Secrets **zusammen** live sein.
