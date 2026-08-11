# Captfix (Mass Master Pro)

Aufmaß-App für Schilder- und Werbetechnikbetriebe. Mitarbeiter fotografieren
Standorte, annotieren die Bilder, erzeugen PDFs; Kunden sehen ihre Projekte
online ein und geben sie frei.

**Produktion:** https://mass-master-pro.vercel.app

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn/ui
- **Backend:** Supabase (Frankfurt) — Postgres, Auth, Storage, Edge Functions
- **Hosting:** Vercel (deployt automatisch auf Push)
- **Offline:** IndexedDB (via `idb`), Sync gegen Supabase

## Lokal starten

Voraussetzung: Node.js und npm.

```sh
npm install
npm run dev          # Dev-Server auf Port 8080
```

Weitere Skripte:

```sh
npm run build        # Produktions-Build
npm run lint         # ESLint
npm test             # Playwright E2E
```

Die Supabase-Zugangsdaten kommen aus `.env` bzw. den Vercel-Environment-
Variablen (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

## Edge Functions

Alle serverseitige Logik liegt in `supabase/functions/`. Deploy und
Migrationen laufen über die Supabase CLI:

```sh
supabase functions deploy <name>
supabase db push
```

Betriebsdaten sind per RLS geschlossen; der Anon-Key darf sie nicht lesen.
Anmeldungen laufen über signierte Session-Tokens plus echte Supabase-Auth-
Sitzungen.

## Dokumentation

| Thema | Datei |
| --- | --- |
| Projektkontext und Konventionen | `CLAUDE.md` |
| Auth-Rollout (Supabase Auth) | `docs/auth-rollout.md` |
| RLS-Härtung | `docs/phase2-rls.md` |
| Privater Storage-Bucket | `docs/phase3-storage.md` |
| Security-Inventar | `docs/security-inventory.md` |
| HERO-Integration | `docs/HERO_INTEGRATION.md` |
| Probo-Produktkatalog | `docs/probo-katalog.md` |
| Deployment | `DEPLOYMENT.md` |
