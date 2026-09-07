# Leitsystem („Aufmaß mit Plan") – Prototyp

Stand: 07.09.2026 · Branch `claude/cool-shannon-rrwxvb` · **nicht deployt, nicht nach main gemerged**

Umsetzung der Spezifikation `spec_aufmass_plan_prototyp.md`. Ziel ist ein
durchklickbarer Prototyp, an dem sich beurteilen lässt, ob Datenmodell und
Bedienung tragen – nicht eine fertige Funktion.

---

## 1. Einschalten und ausprobieren

Der Bereich hängt hinter einem Feature-Flag. Ohne Flag ändert sich für laufende
Projekte nichts – weder in der Projektliste noch in der Projektansicht.

| Aktion | Weg |
| --- | --- |
| Einschalten | `…/projects?leitsystem=1` aufrufen (bleibt im Browser gespeichert) |
| Ausschalten | `…/projects?leitsystem=0` |
| Testprojekt anlegen | Knopf „Testprojekt Musterklinik" im Hinweisbalken der Projektliste |
| Bereich öffnen | Projekt vom Typ *Aufmaß mit Plan* → Karte „Leitsystem (Prototyp)" |

Das Flag liegt in `localStorage` unter `mmp_ff_leitsystem` (`src/lib/featureFlags.ts`).

### Seed-Daten „Musterklinik"

Der Knopf legt in einem Rutsch an: zwei Gebäude, vier Geschosse, sechs
Schildtypen, zehn Ziele, **40 Positionen** (28 davon mit Plan-Marker) und zwei
Grundrisse.

> **Abweichung vom Auftrag:** Die beiden Grundrisse werden auf einem Canvas
> *gezeichnet* statt als PDF mitgeliefert. Die App speichert hochgeladene PDFs
> ohnehin als gerenderte Bildseiten (`FloorPlanUpload`), das Ergebnis im
> Datenbestand ist identisch – aber ohne Binärdatei im Repo und ohne dass beim
> Testen erst eine Datei gesucht werden muss. Echte PDFs lassen sich weiterhin
> über „Grundrisse → Hochladen" einspielen und im Reiter *Struktur* einem
> Geschoss zuordnen.

---

## 2. Was der Prototyp kann

| Reiter | Inhalt |
| --- | --- |
| **Positionen** | Liste mit Filter (Geschoss/Typ/Status/Suche), Position anlegen, Status je Position setzen, Neunummerieren, Detaildialog |
| **Plan** | Marker setzen, per Drag verschieben, nach Typ eingefärbt, Legende aus den verwendeten Typen, dieselben Filter wie die Liste |
| **Typen** | Schildtypen anlegen/bearbeiten/löschen/sortieren inkl. neutralem Beschreibungstext, Hersteller, Artikelnummer, Markerfarbe |
| **Ziele** | Zielverzeichnis mit zweiter Sprache und Verwendungszähler |
| **Struktur** | Gebäude, Geschosse (Kürzel + Ebene), Grundriss-zu-Geschoss-Zuordnung |
| **Stückliste** | Tabelle nach Typ mit Menge/Fläche/Summe, Nachträge separat, Excel-Export |

Im Detaildialog einer Position hängen die **Schilder** (Typ + Menge) und je
Schild die **Beschriftungszeilen** (Ziel oder freier Text, Pfeilrichtung, zweite
Sprache, Piktogramm, Taktil, Braille, Reihenfolge).

### Nicht im Prototyp

Wie in der Spezifikation ausgenommen: Planexport als PDF, Bestellliste,
neutrales LV, GAEB, Fortschrittsansicht, Montageliste, QR-Auflösung,
Herstellerkataloge. Das Datenmodell trägt sie bereits (siehe unten).

---

## 3. Entscheidungen, die vom Vorschlag abweichen

Jeweils mit dem Grund, wie in der Spezifikation gewünscht.

**Positionsnummern werden im Client vergeben, nicht per Datenbankfunktion.**
Die Erfassung passiert vor Ort und muss offline funktionieren – eine
Nummernvergabe über die Datenbank wäre genau dort nicht erreichbar.
`nextPositionNumber()` zählt über die höchste bereits vergebene Nummer
desselben Geschoss-Kürzels hoch. Lücken durch gelöschte Positionen werden
bewusst **nicht** wiederverwendet: sonst bekäme eine neue Position die Nummer
eines Schildes, das vielleicht schon produziert ist.

**Die Zuordnung Grundriss → Geschoss liegt in einer eigenen Tabelle**
(`sign_floor_plan_links`) statt als neue Spalte auf `floor_plans`. So bleibt
der bestehende Grundriss-Sync komplett unangetastet. `floor_plans.markers`
bleibt wie vereinbart stehen und wird vom neuen Modul weder gelesen noch
geschrieben.

**Beschriftungszeilen hängen am Schild, nicht an der Position.**
Fremdschlüssel ist `sign_position_types`, nicht `sign_positions`: an einer
Position sitzen regelmäßig zwei Typen mit völlig verschiedenem Inhalt, etwa
ein Wegweiser und ein Raumnummernschild.

**Eigene IndexedDB-Datenbank (`mmp-signplan-db`) statt neuer Stores in
`aufmass-db`.** Das Schema des Prototyps ändert sich noch, und ein
fehlgeschlagenes Versions-Upgrade der Hauptdatenbank würde Mitarbeiter von
ihren echten Aufmaßen aussperren. Zusammenlegen ist später ein kleiner Schritt
(ein Store, ein Version-Bump), der umgekehrte Weg nicht.

**Eigener Excel-Schreiber (`src/lib/xlsxWriter.ts`) statt CSV oder neuer
Abhängigkeit.** Bei CSV hängt es an Gebietsschema und Trennzeichen, ob Excel
Zahlen als Zahlen übernimmt – das geht regelmäßig schief. Der Schreiber nutzt
JSZip, das für den PDF-Export ohnehin im Bundle liegt, und erzeugt eine echte
`.xlsx` mit drei Blättern.

---

## 4. Sync und Offline-Verhalten

Der Leitsystem-Bestand geht wie gewünscht durch IndexedDB und den bestehenden
Sync. Der Eingriff in `supabaseSync.ts` ist bewusst minimal:

```
syncProjectInternal()          ← neu, ruft nacheinander:
  ├─ syncProjectCore()         ← der bisherige Sync, Zeile für Zeile unverändert
  └─ syncSignPlanProjectSafely()  ← wirft nie, loggt nur
```

Ein Problem im Prototyp kann den produktiven Projekt-Sync also nicht zum
Stehen bringen. Ohne gesetztes Flag und ohne lokale Leitsystem-Daten bricht der
Abgleich sofort ab – wer den Prototyp nicht nutzt, zahlt keine einzige
zusätzliche Abfrage.

### Konfliktauflösung: pro Datensatz statt pro Projekt

Jeder Datensatz trägt `updatedAt`; verglichen wird gegen `updated_at` in
Supabase (`src/lib/signPlanMerge.ts`). Wer an Position 12 arbeitet, während
jemand anderes Position 40 ändert, verliert nichts. **Fassen zwei Leute
denselben Datensatz an, gilt weiterhin last-write-wins** – dieselbe Grenze wie
heute auf Standort-Ebene.

Gelöscht wird lokal als Grabstein (`deletedAt`), damit die Löschung den Weg zur
Gegenseite findet. Ein Datensatz, der remote fehlt, lokal aber existiert, wird
nur hochgeladen, wenn er jünger ist als der letzte erfolgreiche Sync – sonst
wurde er zwischenzeitlich von jemand anderem gelöscht und verschwindet auch
lokal. Grabsteine werden nach 30 Tagen entsorgt.

**Bekannte Grenze:** Wer länger als 30 Tage offline arbeitet und in dieser Zeit
etwas löscht, dessen Löschung kommt beim nächsten Sync nicht mehr an.

---

## 5. Datenbank

Migration: `supabase/migrations/20260907120000_leitsystem_plan_block1.sql`
**Sie ist bewusst nirgends angewendet worden** – weder auf Produktiv noch auf
einen Branch. Vor dem Testen mit echtem Sync einmal auf einen Supabase-Branch
oder ein Testprojekt einspielen.

| Tabelle | Inhalt |
| --- | --- |
| `sign_buildings`, `sign_floors` | Gebäude und Geschosse (Kürzel, Ebene) |
| `sign_floor_plan_links` | Grundriss ↔ Geschoss |
| `sign_types` | Schildtypen inkl. Hersteller, Artikelnummer, neutralem Text, Markerfarbe |
| `sign_positions` | Positionen mit Nummer, Status, Nachtragskennzeichen, optionalem `location_id` |
| `sign_position_types` | n:m Position ↔ Typ **mit Menge** |
| `sign_plan_markers` | Marker mit relativen Koordinaten (0..1) |
| `sign_destinations`, `sign_label_lines` | Zielverzeichnis und Beschriftungszeilen |
| `sign_qr_tokens` | QR-Token je Position (angelegt, im Prototyp nicht aufgelöst) |

Views `sign_bill_of_quantities` und `sign_position_overview`, beide mit
`security_invoker = true`, damit die RLS der Basistabellen greift.

RLS folgt dem bestehenden Muster: `is_staff()` = Vollzugriff, Kunde liest über
`has_customer_project()` nur seine zugewiesenen Projekte, `anon` bekommt
nirgends etwas. Alle Tabellen und Views haben **explizite Grants** wegen der
Data-API-Umstellung zum 30.10.2026.

`sign_positions.position_number` ist `unique (project_id, position_number)` und
**deferrable initially deferred** – das Neunummerieren schreibt ganze Blöcke in
einem Rutsch, dabei tragen zwischenzeitlich zwei Positionen dieselbe Nummer.

Der bestehende Freigabe-Workflow für Kunden (Link, nur Namenseingabe, keine
Registrierung) ist nicht angefasst worden.

---

## 6. Was geprüft wurde

Alles gegen die Seed-Daten (40 Positionen, 68 Schilder) in Chromium:

* **Rechenwege** (Node): Stückliste inkl. Fläche und Summen, Nachträge separat,
  entfallene Positionen zählen nicht mit, Nummernvergabe, Filter,
  Zielverzeichnis-Auflösung inkl. Textüberschreibung.
* **Konfliktauflösung** (Node, 10 Fälle): lokal/remote neuer, Neuanlage,
  Fremdlöschung, Grabstein gegen spätere Fremdänderung, Erstsync,
  Grabstein-Entsorgung.
* **Browser**: IndexedDB schreiben/lesen/Grabstein, Seed-Erzeugung, alle sechs
  Reiter, Marker anklicken, **Marker ziehen und Persistenz in IndexedDB
  nachgelesen**, Position im Plan setzen (`EG-017` mit zwei Schildern),
  fünf Positionen auf „montiert" setzen und danach filtern, Ziel umbenennen und
  Durchschlag auf alle vier verweisenden Zeilen, Excel-Export.
* **Excel**: Datei entpackt, alle XML-Teile wohlgeformt, Blatt „Positionen"
  (Summe 68 Schilder) stimmt mit Blatt „Stückliste" (Summe gesamt 68) überein.
* **Mobil**: 390 px, kein seitliches Scrollen, Liste und Statuswechsel bedienbar.
* `npm run build` läuft durch, der Bereich landet in einem eigenen Chunk
  (56 kB). `tsc` und `eslint` melden für die neuen Dateien nichts – die
  bestehenden 97 `tsc`-Fehler des Repos (veraltete generierte Supabase-Typen)
  sind unverändert.

**Nicht geprüft:** der echte Sync gegen Supabase (die Migration ist nirgends
eingespielt) und das Öffnen der `.xlsx` in Excel selbst.

---

## 7. Ergebnisse aus dem Prototyp – was auffiel

Im Sinne von „wenn ein Schritt hakt, ist das das Ergebnis":

1. **Marker überlagern sich.** Bei den ersten Seed-Daten lagen 14 von 16
   Markern eines Geschosses so dicht beieinander, dass sich der obere nicht
   mehr antippen ließ. Die Seed-Verteilung ist repariert – in echten Projekten
   mit 150 Markern tritt das aber genauso auf. Vor der Abnahme zu klären:
   Marker bei Überlagerung auffächern, oder beim Zoomen entzerren.
2. **Ein Geschoss-Kürzel darf mehrfach vorkommen.** Zwei Gebäude mit einem „EG"
   teilen sich den Nummernkreis (`EG-001` … `EG-032`). Die Nummern bleiben
   eindeutig, aber die Nummer verrät dann nicht mehr das Gebäude. Im Seed
   deshalb `EG` und `B-EG`. Falls das stört, gehört das Gebäudekürzel in die
   Nummer.
3. **Position und Standort sind noch nicht verbunden.** `location_id` steht im
   Datenmodell, aber es gibt keinen Weg in der Oberfläche, an einer Position ein
   Foto aufzunehmen oder einen bestehenden Standort zu verknüpfen. Für die
   mobile Erfassung vor Ort ist das der nächste Schritt und braucht eine
   Entscheidung: entsteht beim Fotografieren einer Position automatisch ein
   Standort, oder bleiben beide Welten getrennt?
4. **Neunummerieren ist gefährlich, sobald produziert wurde.** Die Funktion
   warnt, verhindert es aber nicht. Vorschlag: ab Status „bestellt" die Nummer
   festnageln.
5. **Filter reichen bei 150 Markern.** Kein spürbares Ruckeln; die Marker sind
   normale DOM-Elemente, beim Ziehen wird direkt am Knoten gerechnet und erst
   beim Loslassen gespeichert. Ein Canvas-Umbau ist nicht nötig.

---

## 8. Nächste Schritte

Vor einem Deploy zu klären:

1. Migration auf einen Supabase-Branch oder ein Testprojekt einspielen und den
   Sync mit zwei Geräten gegenprüfen.
2. Punkt 3 oben entscheiden (Position ↔ Standort).
3. Danach in der Reihenfolge der Spezifikation: Planexport als PDF →
   Bestellliste und neutrales LV → Fortschritt und Montageliste → QR-Auflösung
   → Herstellerkataloge → GAEB.
