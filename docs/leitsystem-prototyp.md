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

Das Flag liegt in `localStorage` unter `mmp_ff_leitsystem` (`src/lib/featureFlags.ts`)
und wird in `main.tsx` **vor dem ersten Rendern** gesetzt; `FeatureFlagUrlSync`
in `App.tsx` faengt zusaetzlich den Fall ab, dass der Parameter erst nach dem
Start ankommt (Ruecksprung nach dem Login). Aendert sich der Schalter, laedt die
Seite einmal ohne den Parameter neu, damit alle Ansichten den neuen Wert lesen.

**Wenn nichts anders aussieht**, ist es fast immer einer dieser drei Punkte:

1. Der Parameter fehlt. Ohne `?leitsystem=1` aendert sich nichts – so ist es
   gewollt.
2. Getestet wurde auf `mass-master-pro.vercel.app`. Das ist `main`. Der Branch
   ist bewusst nicht deployt; es braucht die Vercel-Preview-URL des Branches
   oder einen lokalen `npm run dev`.
3. Das geoeffnete Projekt ist nicht vom Typ *Aufmass mit Plan*. Die Karte
   „Leitsystem (Prototyp)" haengt an diesem Projekttyp. Der Knopf
   „Testprojekt Musterklinik" in der Projektliste legt ein passendes an.

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

## 5b. Große Datenmengen: Bilder werden nicht mehr pauschal geladen

**Befund.** `indexedDBStorage.getProject()` hat bisher für JEDEN Standort beide
Fotos per FileReader in einen Base64-String verwandelt – auch wenn die Ansicht
nur die Liste zeigt. Ein Base64-String liegt vollständig im Arbeitsspeicher und
ist ein Drittel größer als die Datei. Gemessen in Chromium mit 1,9-MB-Fotos
(genau die Größe, mit der die App Originale ablegt: 2400 px, Qualität 0,9):

| Standorte | Öffnen | Bilddaten im Speicher |
| ---: | ---: | ---: |
| 25 | 1,7 s | 96 MB |
| 100 | 6,9 s | 385 MB |
| 200 | 12,2 s | 770 MB |
| 300 | 17,0 s | 1154 MB |

Auf einem Desktop mit viel RAM geht das gerade noch; ein Handy-Browser bricht
vorher ab. Für ein Leitsystem mit 300 Positionen war die App damit unbenutzbar –
und das normale Aufmaß wurde ab etwa 50 Standorten spürbar zäh.

**Änderung.** `getProject`, `getLocationsByProject`, `getDetailImagesByLocation`
und `getFloorPlansByProject` nehmen jetzt `includeImages` (und `getProject`
zusätzlich `includeFloorPlanImages`). **Der Standardwert bleibt `true`** – Export,
Sync, Kamera und Editor rufen unverändert auf und bekommen unverändert Base64.

Umgestellt sind nur die Ansichten, die Bilder gar nicht oder nur einzeln
brauchen:

| Ansicht | Lädt |
| --- | --- |
| Projektansicht (Standortliste) | keine Bilder |
| Grundriss-Ansicht | Grundrisse ja, Standortfotos nein |
| Leitsystem-Bereich | Grundrisse ja, Standortfotos nein |

Die Standortkarte holt ihr Bild selbst nach, sobald sie in Sichtweite kommt
(`useNearViewport` + `useBlobUrl`, 400 px Vorlauf) – als **Object-URL** auf den
Blob, nicht als Base64. Die URL wird beim Aufräumen wieder freigegeben.

**Ergebnis, gemessen bei 200 Standorten:**

| | vorher | nachher |
| --- | ---: | ---: |
| Projekt öffnen | 13 913 ms | 161 ms |
| Bilddaten im Speicher | 687 MB | 0 MB |

Ein einzelnes Bild nachzuladen kostet 1,7 ms, zwanzig sichtbare Karten 25 ms.

**Falle, über die ich gestolpert bin:** Der erste Entwurf hängte den
IntersectionObserver an einen Wrapper mit `display: contents`. So ein Element
hat keine Box – der Observer meldet nie etwas, und die Detailbilder wären
dauerhaft Platzhalter geblieben. Die Referenz hängt jetzt direkt am Bild bzw.
am Platzhalter.

---

## 5c. Standortbasierte Erfassung: ohne Foto, Standardfelder, Filter

Der Leitsystem-Bereich ist ein Prototyp neben der Standorterfassung. Diese drei
Änderungen liegen dagegen **direkt in den Standort-Ansichten** – sie gelten für
jedes Projekt und sind der Anfang des Umbaus „alles hängt am Standort".

### Standort im Plan anlegen: Kamera, Hochladen oder ohne Foto

Der Dialog beim Setzen eines Markers heißt jetzt „Standort anlegen" und bietet
drei Wege. **Ohne Foto** legt den Standort sofort an; das Bild lässt sich später
über die Standortkarte nachreichen. Bei 300 Positionen ist die Kamera-Strecke je
Standort der größte Zeitfresser vor Ort.

Zwei Stellen mussten dafür weichen:

* `LocationDetails` betrat den Anlage-Zweig nur mit Bilddaten
  (`else if (imageDataRef.current)`) und **renderte ohne Bild überhaupt nichts**
  (`if (… && !stateImageData) return null`). Beides kennt jetzt `?ohneFoto=1`.
* Der HERO-Upload wird ohne Bild übersprungen – `dataUrlToBlob` wäre auf einem
  leeren String gestolpert.

Die Standortkarte unterscheidet jetzt „lädt noch" von „gibt es nicht" und zeigt
bei einem Standort ohne Foto **„Kein Foto – tippen zum Nachreichen"** statt eines
endlosen Ladebalkens (`useBlobUrl` liefert dafür `state: 'empty'`).

**Nebenbei repariert:** Wird der Dialog abgebrochen, verschwindet der eben
gesetzte Marker wieder. Vorher blieb er als Marker ohne Standort im Plan stehen
und zeigte „?" als Nummer – bei 300 Positionen wäre das Datenmüll.

### Standardfelder für Plan-Projekte

Die Standortfelder bleiben frei konfigurierbar (Admin → Standortfelder). Die
Migration `20260908090000_leitsystem_standard_location_fields.sql` legt lediglich
sechs Felder an, die bei einem Leitsystem praktisch immer gebraucht werden:

| Feld | Typ |
| --- | --- |
| Gebäude, Geschoss, Schildtyp, Menge | Text |
| Montageart | Auswahl (Wand, Decke, Klebe, Boden, Pfosten, Sonstige) |
| Status | Auswahl (Geplant … Abgenommen, Entfallen) |

Alle mit `applies_to = 'aufmass_mit_plan'` – bei normalen Aufmaßen und
Fahrzeugbeschriftungen ändert sich nichts. Die Spalte und die Filterung nach
Projekttyp gab es bereits; die Migration nutzt sie nur. Sie ist idempotent und
legt kein Feld erneut an, das jemand gelöscht hat.

Der Präfix `custom_` ist Pflicht: nur so landen die Werte in
`locations.custom_fields`.

### Filter über der Standortliste

Suchfeld plus ein Auswahlfilter je Feld. Die Filter sind **nicht fest
verdrahtet**, sondern entstehen aus der Feldkonfiguration und den Werten, die im
Projekt tatsächlich vorkommen (`src/lib/locationFilter.ts`). Ein im Admin neu
angelegtes Standortfeld ist damit sofort filterbar, ohne Codeänderung.

Ausgelassen werden Felder, die leer sind oder mehr als 25 verschiedene Werte
haben – ein Kommentarfeld mit 300 verschiedenen Texten ergibt keine sinnvolle
Auswahlliste, dafür gibt es die Suche.

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
* **Bilder-Umbau** (Browser, gegen 200 bzw. 12 Standorte): Standardaufruf
  liefert weiterhin alle Bilder (Standort, Original, Detail, Grundriss);
  Listenaufruf liefert keine Bilder, aber alle Metadaten; Planansicht liefert
  Grundrisse ohne Standortfotos; Einzelnachladen als Blob; unbekannte ID liefert
  `null`. Besonders geprüft: **Löschen eines Standorts aus der bildlos geladenen
  Liste zerstört keine Bilder** der übrigen Standorte, Detailbilder oder
  Grundrisse. Im echten UI: alle 24 Bilder laden beim Durchscrollen als
  Object-URL nach, kein Platzhalter bleibt offen, Lightbox funktioniert.
* **Standortbasierte Erfassung** (Browser, End-to-End): Filterleiste erscheint
  mit den aus der Feldkonfiguration erzeugten Auswahlfeldern; Filter nach System
  reduziert 9 auf 3 Standorte; Suche findet einen; der Plan-Dialog bietet alle
  drei Wege; „Ohne Foto" führt ins Formular, speichert, und der Standort taucht
  in der Liste auf; seine Karte zeigt „Kein Foto", während ein Standort MIT Foto
  sein Bild weiterhin als Blob-URL lädt; Abbrechen im Dialog hinterlässt keinen
  Marker; nach „Ohne Foto" trägt der Marker die richtige Standortnummer.
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
3. **~~Position und Standort sind noch nicht verbunden.~~** Entschieden: es
   bleibt standortbasiert. Der Standort IST die Position. Der Umbau hat mit den
   drei Punkten in Abschnitt 5c begonnen (Erfassung ohne Foto, Standardfelder,
   Filter). **Noch offen:** `sign_positions` auflösen und Schildtyp+Menge,
   Beschriftungszeilen, Plan-Marker und Status an `locations` hängen. Bis dahin
   liegt im Leitsystem-Bereich noch das alte Positionsmodell.
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
