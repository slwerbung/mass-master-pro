

## PDF-Layout Redesign — Professioneller Aufmaß-Bericht

### Aktueller Zustand
Das PDF ist rein funktional: schwarzer Text in verschiedenen Größen, Bilder zentriert, keine visuelle Struktur. Kein Firmenbranding, keine Trennlinien, keine farblichen Akzente.

### Vorgeschlagenes neues Layout

**Deckblatt (neue erste Seite):**
- Projektnummer groß und zentriert
- Datum, Anzahl Standorte
- Horizontale Linie als Akzent in der Primärfarbe (Blau)

**Grundriss-Seiten (unveränderte Logik, besseres Styling):**
- Seitenkopf mit blauer Akzentlinie
- Seitennummer unten rechts

**Standort-Seiten (Hauptänderung):**
- **Seitenkopf**: Dünne blaue Linie oben, Projektnummer rechts oben als Referenz
- **Metadaten-Block**: Grau hinterlegter Kasten mit allen Infos (Standortnummer, Name, System, Art, Beschriftung) in einem sauberen 2-Spalten-Raster statt untereinander
- **Bild(er)**: Mit dünnem Rahmen (1pt grauer Border)
- **Kommentar**: In einem leicht eingerückten Block mit vertikaler Akzentlinie links
- **Footer**: Erstelldatum links, Seitennummer rechts, getrennt durch eine dünne Linie

**Detailbild-Seiten:**
- Gleicher Seitenkopf/Footer
- Bilder mit Beschriftung in einheitlichem Layout

### Technische Umsetzung

Alles in **einer Datei**: `src/pages/Export.tsx` — die `exportAsPDF`-Funktion wird refactored.

Neue Helper-Funktionen innerhalb der Datei:
- `drawPageHeader(pdf, projectNumber, pageNum, totalPages)` — blaue Linie + Projektnummer
- `drawPageFooter(pdf, date, pageNum, totalPages)` — Linie + Seitennummer
- `drawMetadataBox(pdf, location, y, options)` — grauer Kasten mit 2-Spalten-Layout
- `drawImageWithBorder(pdf, dataURI, x, y, w, h)` — Bild mit Rahmen
- `drawCommentBlock(pdf, comment, y)` — Kommentar mit Akzentlinie

Farben aus dem Design-System:
- Primär-Blau: RGB(37, 99, 235) — für Akzentlinien und Marker
- Grau: RGB(243, 244, 246) — für Metadaten-Hintergrund
- Text: RGB(31, 41, 55) — für Haupttext
- Muted: RGB(107, 114, 128) — für sekundären Text

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/pages/Export.tsx` | `exportAsPDF` komplett überarbeiten mit neuen Helper-Funktionen |

### Was sich NICHT ändert
- Export-Optionen (Checkboxen) bleiben gleich
- ZIP-Export bleibt unverändert
- Einzelbild-Downloads bleiben unverändert
- Reihenfolge der Seiten (Grundrisse → Standorte → Details) bleibt gleich

