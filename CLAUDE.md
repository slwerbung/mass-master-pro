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

## Wichtige Dateien
- `src/lib/supabaseSync.ts` – Sync-Logik mit Image Hash Cache + Signed URLs
- `src/lib/indexedDBStorage.ts` – lokaler Speicher (Blobs statt Base64)
- `src/lib/session.ts` – Session-Management mit Ablaufzeit
- `src/pages/Auth.tsx` – Login mit Rate Limiting (5 Versuche → 30s Sperre)
- `src/pages/Admin.tsx` – Admin-Bereich, alle Writes über invoke()
- `src/pages/Camera.tsx` – Kamera mit double-fire Guard
- `src/pages/PhotoEditor.tsx` – Fabric.js Bildeditor
- `src/pages/LocationDetails.tsx` – Standort speichern
- `src/pages/ProjectDetail.tsx` – Projektansicht
- `src/pages/CustomerView.tsx` – Kundenansicht mit Signed URL Cache

## Bekannte Architektur-Entscheidungen
- Storage Bucket `project-files` ist **privat** → immer `createSignedUrl` verwenden, nie `getPublicUrl`
- Bilder werden als **Blob** in IndexedDB gespeichert, nicht als Base64
- Admin-Operationen gehen immer über `invoke("admin-manage", ...)` mit adminToken
- Image Hash Cache in localStorage verhindert Re-Uploads unveränderter Bilder
- Sync läuft debounced (2.5s) und batched (6er-Gruppen)
- Kein Lovable mehr – nur Vercel + Supabase

## Supabase Edge Functions
Deployed via CLI. Alle Functions haben `verify_jwt = false` (eigenes Token-System).
- `validate-admin` – Admin-Passwort prüfen
- `validate-employee` – Mitarbeiter-Login
- `validate-session` – Session-Token validieren
- `admin-manage` – alle Admin-Operationen (CRUD Mitarbeiter, Kunden, Felder etc.)
- `customer-data` – Kundendaten laden
- `validate-guest` – Gastzugang prüfen
- `guest-data` – Gastprojektdaten
- `ensure-customer-assignment` – Kundenzuweisung sicherstellen
- `get-view-settings` – Sichtbarkeitseinstellungen laden
- `send-notification` – E-Mail-Benachrichtigung via Resend
- `update-guest-info` – Gastinfos aktualisieren

## Workflow
1. Änderungen direkt im Repo vornehmen
2. `git add .` → `git commit -m "..."` → `git push`
3. Vercel deployed automatisch

## Commit-Stil
Kurze prägnante Messages auf Englisch:
- `fix: beschreibung`
- `feat: beschreibung`
- `perf: beschreibung`
- `chore: beschreibung`

## Was vermeiden
- Niemals `getPublicUrl` verwenden (Bucket ist privat)
- Keine direkten Supabase-Writes in Admin-Funktionen (immer invoke())
- Keine Base64-Strings direkt in IndexedDB speichern
- Kein `navigate()` direkt im Render-Rückgabepfad (immer useEffect)
- Keine unbegrenzten Promise.all bei vielen Bildern (loadInBatches verwenden)
