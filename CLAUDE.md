# Mass Master Pro – Claude Code Kontext

## Projekt
Professionelle Aufmaß-App für Schilder-/Werbetechnikfirmen.
Mitarbeiter fotografieren Standorte, annotieren Bilder, exportieren PDFs.
Kunden können Projekte online einsehen und freigeben.

## Stack
- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn/ui
- **Backend:** Supabase (Frankfurt, ref: `tocukaqhclkskpvvxmrr`)
- **Deployment:** Vercel → https://mass-master-pro.vercel.app
- **Repo:** C:\Users\info\Documents\GitHub\mass-master-pro
- **Lokaler Speicher:** IndexedDB (via idb), Sync mit Supabase

## Rollen
- `admin` – voller Zugriff, Verwaltung
- `employee` – Projekte anlegen und bearbeiten
- `customer` – Kundenansicht, Freigaben, Feedback
- `guest` – Direktzugang per Projekt-Link (nutzt separaten `guest_token`)

## Auth-Modell (Stand Batch A+B, April 2026)
- Admin, Employee und Customer loggen sich über eine Edge Function ein und
  bekommen einen **HMAC-signierten Session-Token** zurück (12 h gültig).
- Signing-Secret: `SESSION_SIGNING_SECRET` in Supabase Secrets. Muss mind. 32
  Zeichen lang sein, sonst crashen die Functions mit klarer Fehlermeldung.
- Guest hat weiter einen separaten `guest_token` (HMAC über `GUEST_TOKEN_SECRET`)
  für Direktzugriff auf ein einzelnes Projekt per Link.
- `customer-data` akzeptiert **nur noch** signierte Customer-Tokens; die alte
  `customerId`-Variante (blind vertraut) ist entfernt.
- `hero-integration` verlangt einen echten Admin- oder Employee-Token.

## Wichtige Dateien
- `src/lib/supabaseSync.ts` – Sync-Logik mit SHA-256 Image-Hash Cache (v3)
- `src/lib/indexedDBStorage.ts` – lokaler Speicher (Blobs statt Base64), defensive updateLocationMetadata
- `src/lib/session.ts` – Session-Management mit Ablaufzeit
- `src/pages/Auth.tsx` – Login (Admin/Employee/Customer), Rate Limiting
- `src/pages/CustomerLogin.tsx` – /kunde Login-Route, nutzt `validate-customer`
- `src/pages/Admin.tsx` – Admin-Bereich, alle Writes über invoke()
- `src/pages/Camera.tsx` – Kamera mit double-fire Guard
- `src/pages/PhotoEditor.tsx` – Fabric.js Bildeditor
- `src/pages/LocationDetails.tsx` – Standort speichern
- `src/pages/ProjectDetail.tsx` – Projektansicht
- `src/pages/CustomerView.tsx` – Kundenansicht (alle Writes über customer-data mit Token)

## Bekannte Architektur-Entscheidungen
- Storage Bucket `project-files` ist aktuell **public** (siehe Migration
  `20260415140000_make_bucket_public.sql`). `getPublicUrl` ist hier korrekt.
  → TODO Batch C: Bucket wieder privat + Signed URLs via neue Edge Function
  `get-signed-url`. Bis dahin sind Storage-Pfade vorhersagbar; nicht schön,
  aber funktionsfähig.
- Bilder werden als **Blob** in IndexedDB gespeichert, nicht als Base64
- Admin-Operationen gehen immer über `invoke("admin-manage", ...)` mit `adminToken`
- Image Hash Cache (SHA-256) in localStorage verhindert Re-Uploads unveränderter Bilder
- Sync läuft debounced (2,5 s) und batched (6er-Gruppen)
- Kein Lovable mehr – nur Vercel + Supabase

## Supabase Edge Functions
Deployed via CLI. Alle Functions haben `verify_jwt = false` (eigenes Token-System).
- `validate-admin` – Admin-Passwort prüfen, signierten Token ausstellen
- `validate-employee` – Mitarbeiter-Login, signierten Token ausstellen
- `validate-customer` – Customer-Login (Name-Match), signierten Token ausstellen
- `validate-session` – Session-Token validieren (admin/employee/customer)
- `validate-guest` – Gastzugang prüfen, guest_token ausstellen
- `admin-manage` – alle Admin-Operationen (CRUD Mitarbeiter, Kunden, Felder etc.)
  (`get_project_prefix` und `get_integration_config` sind public actions)
- `customer-data` – Kundendaten laden/schreiben, verlangt `customerToken`
- `guest-data` – Gastprojektdaten, verlangt guest_token
- `ensure-customer-assignment` – Kundenzuweisung sicherstellen
- `get-view-settings` – Sichtbarkeitseinstellungen laden
- `send-notification` – E-Mail-Benachrichtigung via Resend
- `update-guest-info` – Gastinfos aktualisieren
- `hero-integration` – HERO-Software GraphQL-Gateway, verlangt echten Token

## Offene Baustellen (Batch C – separate Session)
1. Anon-RLS auf `SELECT` beschränken, Writes nur noch über Edge Functions
2. Bucket privat + Signed URLs via Edge Function
3. Konflikt-Sync: Location-Level-Timestamps oder Operations-Queue statt
   last-write-wins auf Projekt-Ebene

## Workflow
1. Änderungen direkt im Repo vornehmen
2. `git add .` → `git commit -m "..."` → `git push`
3. Vercel deployed automatisch
4. Edge-Function-Änderungen manuell via `supabase functions deploy <name>`
5. Migrations via `supabase db push`

## Commit-Stil
Kurze prägnante Messages auf Englisch:
- `fix: beschreibung`
- `feat: beschreibung`
- `perf: beschreibung`
- `chore: beschreibung`
- `sec: beschreibung` (Security-Fixes)

## Was vermeiden
- Niemals Signing-Secret-Fallback im Code (kein `|| "fallback"`)
- Keine direkten Supabase-Writes in Admin-Funktionen (immer invoke())
- Keine Base64-Strings direkt in IndexedDB speichern
- Kein `navigate()` direkt im Render-Rückgabepfad (immer useEffect)
- Keine unbegrenzten Promise.all bei vielen Bildern (loadInBatches verwenden)
- Kein GraphQL-String-Interpolation für fremde Inputs (immer Variables nutzen)
- Bei `updateLocationMetadata` (und ähnlichen partial-updates) niemals
  Felder blind `...record, field: data.field` setzen – das überschreibt mit
  undefined. Immer `Object.prototype.hasOwnProperty.call(data, 'field')`.
