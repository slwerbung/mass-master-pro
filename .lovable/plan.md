

## Plan: PDF-Export mit Optionen (Eine Seite pro Standort)

### Übersicht
Der PDF-Export wird überarbeitet mit konfigurierbaren Optionen. **Jeder Standort wird komplett auf einer Seite dargestellt** - die Bildgrößen werden dynamisch angepasst, damit alles passt.

---

### Schritt 1: PDF-Optionen State hinzufügen

**Datei: `src/pages/Export.tsx`**

Neuer State für Export-Optionen:
```typescript
interface PDFExportOptions {
  includeProjectHeader: boolean;      // Projektnummer
  includeLocationNumber: boolean;     // Standortnummer
  includeLocationName: boolean;       // Standortname
  includeAnnotatedImage: boolean;     // Bemaßtes Bild
  includeOriginalImage: boolean;      // Originalbild
  includeComment: boolean;            // Kommentar
  includeCreatedDate: boolean;        // Erstellungsdatum
}
```

---

### Schritt 2: Optionen-UI erstellen

Aufklappbare Optionen-Sektion mit Checkboxen:

```
┌──────────────────────────────────────────┐
│ 📄 PDF-Dokument                          │
├──────────────────────────────────────────┤
│ ⚙️ Export-Optionen anpassen              │
│                                          │
│ Allgemein:                               │
│ ☑ Projektnummer                          │
│ ☑ Standortnummer                         │
│ ☑ Standortname                           │
│ ☑ Erstellungsdatum                       │
│                                          │
│ Bilder:                                  │
│ ☑ Bemaßtes Bild                          │
│ ☐ Originalbild (unbearbeitet)            │
│                                          │
│ Inhalt:                                  │
│ ☑ Kommentar                              │
│                                          │
│ [PDF herunterladen]                      │
└──────────────────────────────────────────┘
```

---

### Schritt 3: Seitenlayout mit dynamischer Skalierung

**Eine A4-Seite = 210 x 297 mm**

Verfügbarer Platz (mit Rändern):
- Breite: 170 mm (20mm Rand links/rechts)
- Höhe: 257 mm (20mm Rand oben/unten)

**Layout-Berechnung:**

```
Verfügbare Höhe: 257 mm
- Header (Projekt/Standort): ~25 mm
- Kommentar: ~15 mm
- Datum: ~10 mm
- Abstände: ~15 mm
───────────────────────────────
= Verfügbar für Bilder: ~192 mm

Bei 1 Bild:  maxHeight = 180 mm
Bei 2 Bildern: maxHeight = 90 mm pro Bild (mit 10mm Abstand)
```

**Proportionale Skalierung (keine Verzerrung):**
```typescript
const getImageDimensions = async (dataURI: string) => {
  return new Promise<{width: number, height: number}>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.src = dataURI;
  });
};

// Bild proportional skalieren
const maxWidth = 170;
const maxHeight = bothImages ? 90 : 180;
const ratio = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
const scaledWidth = imgWidth * ratio;
const scaledHeight = imgHeight * ratio;
```

---

### Schritt 4: Seiten-Layout pro Standort

```
┌─────────────────────────────────────┐ ← Seite 1
│ Projekt 2025-001                    │
│ Standort 001 - Küche                │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │     Bemaßtes Bild               │ │
│ │     (max 90mm hoch bei 2 Bildern)│ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │     Originalbild                │ │
│ │     (max 90mm hoch)             │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Kommentar: Fenster muss getauscht...│
│ Erstellt am 15.01.2025              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐ ← Seite 2
│ Projekt 2025-001                    │
│ Standort 002 - Bad                  │
│ ...                                 │
```

---

### Schritt 5: Lokalisierung korrigieren

**Datei: `src/pages/PhotoEditor.tsx`**
- `"Sel"` → `"Ausw."` (Auswahl-Werkzeug)

---

### Zusammenfassung der Änderungen

| Datei | Änderung |
|-------|----------|
| `src/pages/Export.tsx` | PDF-Optionen UI, überarbeitete `exportAsPDF` mit dynamischer Bildskalierung |
| `src/pages/PhotoEditor.tsx` | Lokalisierung: "Sel" → "Ausw." |

### Technische Garantien
- **Kein Seitenumbruch** innerhalb eines Standorts
- **Keine Verzerrung** durch proportionale Skalierung
- **Dynamische Höhe** je nach Anzahl der Bilder (1 oder 2)
- **Bilder zentriert** auf der Seite

