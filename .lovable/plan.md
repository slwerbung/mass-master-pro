

# Export des kompletten Supabase-Projekts

## Vorgehen

Ich erstelle ein vollständiges Migrations-Paket als Dateien in `/mnt/documents/`, das du direkt in deinem eigenen Supabase-Projekt verwenden kannst:

### 1. `complete_schema.sql` — Konsolidierte Datenbank-Migration
Eine einzelne, saubere SQL-Datei, die alle 29 Migrations-Dateien zu einem idempotenten Schema zusammenfasst. Enthält:
- Alle 19 Tabellen (projects, locations, employees, customers, etc.)
- Fehlende Tabellen/Spalten die nur in der Live-DB existieren (`customer_notifications`, `locations.image_data`)
- Alle Views (`employees_public`)
- Alle Funktionen (`update_updated_at_column`, `owns_project`)
- Trigger (`update_projects_updated_at`)
- Storage-Bucket (`project-files`, private)
- Storage-Policies
- Alle aktuellen RLS-Policies (finaler Zustand nach allen Migrations)
- Seed-Daten (Default Field Config)

### 2. `edge_functions/` — Alle Edge Functions als Quellcode-Kopie
Kopie aller 12 Edge Functions + shared module:
- `_shared/session.ts`
- `admin-manage/index.ts`
- `customer-data/index.ts`
- `ensure-customer-assignment/index.ts`
- `get-view-settings/index.ts`
- `guest-data/index.ts`
- `send-notification/index.ts`
- `update-guest-info/index.ts`
- `validate-admin/index.ts`
- `validate-employee/index.ts`
- `validate-guest/index.ts`
- `validate-session/index.ts`

### 3. `config.toml` — Function-Konfiguration
Die `config.toml` für dein neues Projekt (ohne `project_id`, die trägst du selbst ein).

### 4. `SETUP_GUIDE.md` — Schritt-für-Schritt-Anleitung
Enthält:
- Reihenfolge der Schritte
- Secrets-Liste (nur Namen, keine Werte):
  - `ADMIN_PASSWORD`
  - `SESSION_SIGNING_SECRET`
  - `GUEST_TOKEN_SECRET`
  - `RESEND_API_KEY` (optional, für E-Mail-Benachrichtigungen)
- Deploy-Befehle für alle Edge Functions
- Hinweise zur Frontend-Konfiguration (`.env` anpassen)

### 5. `raw_migrations/` — Originale Migrations-Dateien
Alle 29 Original-Migrations als Backup/Referenz.

## Technische Details

- Die konsolidierte SQL-Datei ist idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`)
- Storage-Bucket wird als **private** erstellt (aktueller Stand)
- `customer_notifications`-Tabelle und `locations.image_data`-Spalte werden ergänzt (existieren in DB, fehlen in Migrations)
- Alle Foreign Keys werden korrekt aufgelöst (Reihenfolge der CREATE TABLE Statements)

