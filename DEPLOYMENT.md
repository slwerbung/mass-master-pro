# Aufmaß App - Deployment Anleitung

## Eigenständige Installation auf dem Smartphone

Diese App läuft komplett lokal auf deinem Smartphone. Alle Daten werden im Browser gespeichert, es ist keine Server-Verbindung nötig.

## Build-Prozess

### 1. Voraussetzungen
- Node.js (Version 18 oder höher)
- npm oder bun

### 2. Projekt bauen

```bash
# Dependencies installieren
npm install

# Production Build erstellen
npm run build
```

Der Build-Prozess erstellt einen `dist` Ordner mit allen notwendigen Dateien.

## Deployment-Optionen

### Option 1: Kostenlos auf Netlify (Empfohlen)

1. Erstelle einen kostenlosen Account auf [netlify.com](https://netlify.com)
2. Ziehe den `dist` Ordner per Drag & Drop in Netlify
3. Netlify gibt dir eine URL (z.B. `https://deine-app.netlify.app`)
4. Öffne diese URL auf deinem Smartphone und installiere die App

### Option 2: Kostenlos auf Vercel

1. Erstelle einen kostenlosen Account auf [vercel.com](https://vercel.com)
2. Lade den `dist` Ordner hoch
3. Öffne die erhaltene URL auf deinem Smartphone

### Option 3: GitHub Pages (Kostenlos)

1. Erstelle ein GitHub Repository
2. Pushe den Code
3. Gehe zu Settings → Pages
4. Aktiviere GitHub Pages mit dem `dist` Ordner
5. Öffne die URL auf deinem Smartphone

### Option 4: Eigener Server

Wenn du einen eigenen Webserver hast:

```bash
# Lade den dist Ordner auf deinen Server
# Beispiel mit SCP:
scp -r dist/* user@deineserver.de:/var/www/html/
```

## Installation auf dem Smartphone

### Android (Chrome/Edge)

1. Öffne die URL in Chrome oder Edge
2. Tippe auf das Menü (⋮)
3. Wähle "App installieren" oder "Zum Startbildschirm hinzufügen"
4. Die App erscheint als Icon auf deinem Homescreen

### iOS (Safari)

1. Öffne die URL in Safari
2. Tippe auf das Teilen-Symbol
3. Wähle "Zum Home-Bildschirm"
4. Die App erscheint als Icon auf deinem Homescreen

## Wichtige Hinweise

### Datenspeicherung
- Alle Daten (Projekte, Fotos) werden **lokal im Browser** gespeichert
- Die Daten bleiben auch offline verfügbar
- **WICHTIG**: Wenn du den Browser-Cache löschst, gehen die Daten verloren!
- Nutze die Export-Funktion regelmäßig als Backup

### Speicherplatz
- Die App komprimiert Bilder automatisch
- Pro Projekt sollten etwa 50-100 Fotos möglich sein
- Bei Speicherproblemen: Projekte als PDF exportieren und dann löschen

### Offline-Nutzung
- Die App funktioniert vollständig offline
- Du brauchst **keine Internetverbindung** nach der Installation
- Updates erfordern eine kurze Online-Verbindung

### Browser-Kompatibilität
- ✅ Chrome/Edge (Android): Vollständig unterstützt
- ✅ Safari (iOS): Vollständig unterstützt
- ⚠️ Firefox Mobile: Eingeschränkt (PWA-Support limitiert)

## Technische Details

Die App ist eine Progressive Web App (PWA) mit:
- Service Worker für Offline-Funktionalität
- LocalStorage für Datenspeicherung
- Camera API für Foto-Aufnahme
- Canvas API für Bildbearbeitung

## Support & Updates

Um die App zu aktualisieren:
1. Baue eine neue Version mit `npm run build`
2. Ersetze die Dateien auf dem Webserver
3. Die App aktualisiert sich automatisch beim nächsten Start

## Datenschutz

✅ **100% Privat**: Keine Datenübertragung an Server
✅ **Keine Tracking**: Keine Analyse-Tools
✅ **Lokal**: Alle Daten bleiben auf deinem Gerät
