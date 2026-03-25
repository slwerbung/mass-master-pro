

## Fix: Leerer Präfix + Lösch-Button

### Problem
1. `data.prefix || "WER-"` (Zeile 120) behandelt leeren String als falsy → fällt auf "WER-" zurück
2. Kein expliziter "Löschen"-Button — Benutzer weiß nicht, dass leeres Feld = kein Präfix

### Änderungen

**`src/pages/Admin.tsx`**:
- Zeile 120: `data.prefix || "WER-"` → `data.prefix ?? "WER-"` (nur null/undefined → Fallback)
- Zeile 121: Fehler-Fallback auf `""` statt `"WER-"`
- Zeile 371-374: Neben dem Speichern-Button einen "Löschen"-Button hinzufügen, der `projectPrefix` auf `""` setzt und sofort `invoke("set_project_prefix", { prefix: "" })` aufruft
- Hinweis-Text ergänzen: "Leer lassen oder löschen für keinen Präfix"

**`src/pages/NewProject.tsx`**:
- Default-State von `"WER-"` auf `""` ändern
- Präfix-Span nur anzeigen wenn `prefix` nicht leer ist

### UI-Ergebnis
```
[Input: WER-     ] [Speichern] [Löschen]
Leer lassen oder löschen für keinen Präfix.
```

