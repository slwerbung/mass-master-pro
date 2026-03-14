

## Plan: Migrationen ausführen und Build-Fehler beheben

### Problem
Build-Fehler wegen fehlender Tabellen:
- `app_config` - für Admin-Passwort und Konfiguration
- `location_field_config` - für dynamische Standortfelder  
- `location_approvals` - für Kunden-Freigaben
- `locations.custom_fields` Spalte fehlt

### Lösung
Die bereitgestellten SQL-Migrationen ausführen, die diese Tabellen erstellen und mit Default-Daten befüllen.

### Schritte
1. Migration für fehlende Tabellen ausführen
2. Anschließend prüfen ob die Types korrekt generiert werden
3. Build-Fehler sollten dann verschwinden

