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

### Gebäude und Geschoss stehen im Code, alles andere im Admin

Hier gibt es zwei Sorten Felder, und die Unterscheidung ist wichtig:

**Gebäude und Geschoss sind eingebaut** (`PLAN_BUILTIN_FIELDS` in
`src/lib/planFields.ts`). Sie sind kein frei definierbares Standortfeld,
sondern Teil der Mechanik: die Vererbung vom Grundriss und das Geschoss-Kürzel
in der Standortnummer hängen an ihnen. Müsste man sie erst im Admin anlegen,
wäre beides so lange still kaputt – ohne Fehlermeldung, denn ein fehlendes Feld
vererbt einfach nichts. Sie erscheinen **nur bei Plan-Projekten**; bei normalen
Aufmaßen und Fahrzeugbeschriftungen ändert sich nichts.

`withPlanBuiltinFields(configs, projektTyp)` mischt sie in die Feldliste, an
vier Stellen: Standortformular, Standortliste samt Filter, Export und
Kundenansicht. Wer sich im Admin selbst ein Feld „Gebäude" anlegt, behält es –
der Dublettenschutz geht über Schlüssel **und** Label, und das eigene Feld
gewinnt, weil daran die bereits erfassten Werte hängen.

**Die übrigen vier legst du selbst im Admin an** (Projekttyp *Aufmaß mit Plan*).
Eine Migration dafür gab es kurzzeitig; sie ist wieder entfernt, weil ein
späteres `supabase db push` die Felder ein zweites Mal angelegt hätte.

| Label | Typ | Auswahlwerte |
| --- | --- | --- |
| Schildtyp | Text | – |
| Menge | Text | – |
| Montageart | Auswahl | Wand, Decke, Klebe, Boden, Pfosten, Sonstige |
| Status | Auswahl | Geplant, Freigegeben, Bestellt, Produziert, Montiert, Abgenommen, Entfallen |

Der Präfix `custom_` ist Pflicht, damit die Werte in `locations.custom_fields`
landen – den vergibt der Admin automatisch.

**Dabei aufgefallen:** Der Standort erbte zweimal. Die Vererbung lief einmal
los, bevor die Feldkonfiguration geladen war (also in den eingebauten
Schlüssel), und ein zweites Mal danach (in das selbst angelegte Feld). Der
erste Wert blieb als Karteileiche in `custom_fields` stehen und wäre
mitsynchronisiert worden. Die Vererbung wartet jetzt auf ein geladenes
`fieldConfigsLoaded` – „noch nicht geladen" und „geladen, aber leer" sehen
sonst gleich aus.

### Was „ohne Foto" sonst noch berührt hat

Ein Standort ohne Bild ist ein Zustand, den es vorher nicht gab. Beim Nachprüfen
fiel auf, dass zwei Stellen das nicht vertragen:

* **ZIP-Export brach komplett ab.** `dataURItoBlob("")` wirft – ein einziger
  Standort ohne Foto hätte den Export des ganzen Projekts verhindert. Jetzt
  werden leere Bilder übersprungen (die Detailbilder waren bereits geprüft).
  Die Download-Knöpfe der Einzelbilder sind bei fehlendem Bild deaktiviert.
* **„Tippen zum Nachreichen" führte in einen leeren Editor.** Der PhotoEditor
  verwirft beim Re-Edit bewusst das Handoff-Bild und lädt aus IndexedDB – bei
  einem Standort ohne Bild also nichts. Jetzt öffnet die Karte stattdessen eine
  Auswahl (Kamera / Hochladen); das Bild geht mit `?neu=1` in den Editor, der es
  beim Speichern als Hauptbild des bestehenden Standorts setzt.

**Nicht betroffen, geprüft:** Das PDF (`drawLocationPage` prüft `if
(opts.mainImage)`, `placeImageContain` fängt Fehler ab), die Edge-Function-PDFs
(`photoEmbed` bleibt null) und die Kundenansicht (liest `location_images`-Zeilen,
die es ohne Foto gar nicht gibt).

### Gebäude und Geschoss hängen am Grundriss

Ein Grundriss zeigt immer genau ein Geschoss eines Gebäudes. Beides an jedem
einzelnen Schild zu erfassen hieße bei 300 Positionen 600 überflüssige
Eingaben.

**Gepflegt wird am Plan** – beim Hochladen (mit Geschoss-Vorschlag aus dem
Seitennamen) oder nachträglich über „Bearbeiten" in der Grundriss-Ansicht.
Die Reiter zeigen dann „Haus A · 1. OG" statt „Plan_final_v3"; ein Plan ohne
Angaben zeigt weiter seinen Dateinamen und bietet „Gebäude / Geschoss
ergänzen" an.

**Geerbt wird an den Standort.** Wer auf diesem Plan einen Standort setzt,
bekommt Gebäude und Geschoss automatisch in seine Felder – überschreibbar, für
das Schild im Treppenhaus zwischen zwei Geschossen.

Die Werte landen dabei **am Standort** (`locations.custom_fields`) und nicht
nur am Plan. Das ist wichtig: Filter, Stückliste, Export und die
Positionsnummer arbeiten unverändert mit den Standortfeldern weiter – der Plan
liefert nur die Vorgabe. Wäre der Wert nur am Plan, müsste jede dieser Stellen
eine Sonderbehandlung bekommen.

Weil Standortfelder frei konfigurierbar sind, sucht `findFieldKey()` erst den
Standardschlüssel (`custom_gebaeude`, `custom_geschoss`) und fällt dann auf das
Label zurück – ein im Admin angelegtes Feld heißt `custom_<Zeitstempel>`.

Speicherseitig: zwei optionale Spalten an `floor_plans`
(`20260909100000_floor_plans_building_floor.sql`), dieselben Felder im
IndexedDB-Store (ohne Version-Bump, neue Felder brauchen keinen) und im Sync.
`updateFloorPlanMeta()` ändert die Kopfdaten, ohne das Planbild neu zu
schreiben.

> **Die frühere Namens-Heuristik ist damit weg.** Sie hat aus dem Plannamen
> geraten, was jetzt explizit am Plan steht. Der Vorschlag beim Anlegen eines
> Grundrisses nutzt sie weiterhin – dort ist Raten in Ordnung, weil man den
> Vorschlag einmal sieht und korrigieren kann.

### Standortnummer mit Geschoss-Präfix

Ist am Standort ein Geschoss erfasst, bekommt die Nummer dessen Kürzel
vorangestellt: **„EG-109"**, „1OG-110", „UG-111". Ohne Geschoss bleibt es bei der
reinen Zahl wie bisher.

Die laufende Zahl bleibt bewusst **projektweit** und zählt weiter wie bisher –
aus zwei Gründen:

1. Alle Stellen, die die Nummer wieder zerlegen, funktionieren unverändert:
   `nextLocationNumber` liest die Ziffern am Ende, Plan-Marker und PDF-Export
   nehmen den Teil hinter dem letzten Bindestrich. Für sie sieht „EG-109" aus
   wie das schon bestehende Altformat „WER-1234-100".
2. Die Nummer bleibt eindeutig, auch wenn jemand das Geschoss nachträglich
   ändert. Sie ist die ID, auf die sich Plan, Liste, Produktion, Monteur und
   Kunde beziehen – sie darf sich nicht unter der Hand verschieben. Eine
   vergebene Nummer wird deshalb nicht umgeschrieben.

Erkannt werden „Erdgeschoss"/„Parterre" → EG, „1. OG"/„1.OG"/„OG 1" → 1OG,
„2. Obergeschoss" → 2OG, „3. Etage" → 3OG, Untergeschoss → UG, Keller → KG,
Dachgeschoss → DG, Zwischengeschoss → ZG. Was sich keinem Muster zuordnen
lässt, wird auf vier Zeichen gekürzt – wer das Geschoss selbst eintippt, soll
auch ein eigenes Kürzel bekommen.

**Vorbelegung aus dem Grundriss.** Wer 30 Schilder im EG erfasst, soll
„Erdgeschoss" nicht 30-mal tippen. Beim Anlegen aus dem Plan wird das
Geschossfeld deshalb aus dem Grundrissnamen vorbelegt – aber **nur, wenn darin
wirklich ein Geschoss steckt**. Im Test fiel auf, dass ein Grundriss namens
„Grundriss" sonst zum Kürzel „GRUN" geführt hätte; „Seite 1" zu „SEIT".
`recognizeFloor()` unterscheidet deshalb erkanntes Muster von Notbehelf.

Die Etagenzahl wird nur unmittelbar neben dem Geschosswort gesucht und darf
höchstens zweistellig sein – sonst wäre aus „Plan_EG_2024" das Kürzel „2024EG"
geworden.

### Filter über der Standortliste

Suchfeld plus ein Auswahlfilter je Feld. Die Filter sind **nicht fest
verdrahtet**, sondern entstehen aus der Feldkonfiguration und den Werten, die im
Projekt tatsächlich vorkommen (`src/lib/locationFilter.ts`). Ein im Admin neu
angelegtes Standortfeld ist damit sofort filterbar, ohne Codeänderung.

Ausgelassen werden Felder, die leer sind oder mehr als 25 verschiedene Werte
haben – ein Kommentarfeld mit 300 verschiedenen Texten ergibt keine sinnvolle
Auswahlliste, dafür gibt es die Suche.

### Nachgeladene Bilder reservieren ihre Hoehe vorher

Das Nachladen der Bilder hatte eine Nebenwirkung, die erst beim Scrollen
auffaellt: Bis das Bild da war, stand in der Karte ein Platzhalter von 180 px,
waehrend das fertige Foto 300 bis 500 px hoch ist. Jede Karte wuchs also in
dem Moment, in dem ihr Bild ankam – auch die unterhalb des Sichtbereichs.
Damit wurde die Seite beim Scrollen laufend laenger, und man kam nicht ans
Ende, weil das Ende vor einem weglief.

Gemessen mit zwoelf Standorten (gemischt quer und hoch):

| | Zuwachs beim Scrollen | nach einem Wisch noch vom Ende entfernt |
| --- | --- | --- |
| vorher, Handy | 382 px | 148 px |
| vorher, Rechner | 620 px | 155 px |
| nachher, erstes Oeffnen | 208 px / 0 px | 105 px / 0 px |
| nachher, danach | **0 px** | **0 px** |

Die Karte reserviert die Hoehe jetzt ueber `aspect-ratio`, bevor das Bild da
ist. Das Seitenverhaeltnis kommt aus `src/lib/imageAspect.ts`: beim Speichern
eines Fotos einmal gemessen, sonst beim ersten Anzeigen gelernt, gemerkt in
`localStorage` (wie der Bild-Hash-Cache – es ist eine Anzeige-Optimierung,
kein Datenbestand). Unbekannt heisst 4:3; ein Hochformat-Foto wandert dann
beim allerersten Ansehen noch einmal und steht danach.

Zwei Details, die beim Bauen noetig wurden:

* **`width` muss ausdruecklich auf 100%.** Sonst zieht `aspect-ratio` den
  Kasten schmal, sobald `max-height` greift – der graue Grund waere bei einem
  Hochformat-Foto nur noch so breit wie das Bild statt so breit wie die Karte.
* **Jede Detailbild-Kachel braucht ihre eigene reservierte Hoehe**
  (`DetailTile`), sonst springt beim Nachladen die ganze Rasterzeile.

Nachgemessen, dass sich am Aussehen nichts aendert: Karte, Bildkasten und
dargestelltes Bild liegen vorher wie nachher auf denselben Pixeln
(846x630 an Position 46, quer wie hoch).

---

### Zoom im Grundriss

Ein A1-Architektenplan auf einem Handy ist ohne Zoom nicht bedienbar: Räume sind
nicht lesbar, und zwei Schilder an derselben Flurkreuzung liegen als Marker
übereinander (siehe Abschnitt 7, Punkt 1). `src/components/ZoomableFloorPlan.tsx`
bringt Mausrad, Pinch, Ziehen, Doppeltipp und drei Knöpfe (+, −, „Ganzer Plan"),
1× bis 8×, mit Prozentanzeige.

Der entscheidende Punkt ist die **Trefferpunkt-Rechnung**. Vorher rechnete
`FloorPlanView` aus dem Rahmen (`imageContainerRef`), was ohne Zoom dasselbe war.
Jetzt kommen die relativen Koordinaten aus der **Bildbox**:

```ts
const rect = imageRef.current.getBoundingClientRect();
const x = (event.clientX - rect.left) / rect.width;
```

`getBoundingClientRect()` liefert die bereits transformierte Box – damit stimmt
die Stelle bei jedem Zoomstand, ganz ohne eigene Umrechnung von Zoom und
Verschiebung. Ein Tippen neben den Plan (`x < 0 || x > 1`) legt nichts an.

Drei Details, die beim Bauen nötig wurden:

* **Marker werden gegenskaliert** (`scale(1 / zoom)`, `transformOrigin: bottom
  center`). Sie kleben an ihrem Punkt, bleiben aber gleich groß – bei 400 % wäre
  ein mitwachsender Marker so groß wie ein halber Raum.
* **Tippen und Ziehen müssen sich unterscheiden.** Erst ab 5 px Bewegung gilt
  eine Geste als Verschieben; sonst würde jeder leicht wackelige Finger das
  Setzen eines Markers verschlucken.
* **Verschieben wird begrenzt** (`clampOffset`), sonst schiebt man den Plan aus
  dem Rahmen und findet ihn nicht wieder. Ein Viertel Rahmen darf frei bleiben.

Geprüft in Chromium gegen einen 10×8-Raster-Plan mit beschrifteten Feldern: ein
Klick auf die Mitte von Feld „73" ergibt bei 100 % den Marker `0,750 / 0,4375`.
Nach dem Hineinzoomen auf 299 % an derselben Stelle liegt der Punkt weiterhin in
Feld „73", und der Klick ergibt **exakt dieselbe Koordinate** (Abweichung
dx = dy = 0,0000). Ein Klick in den freien Rahmen neben dem Plan öffnet keinen
Dialog.

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
* **Vererbung vom Grundriss** (Node, 14 Fälle + Browser): Plan mit „Haus A" /
  „1. OG" vererbt beides an den neuen Standort, die Werte stehen in
  `customFields`, die Nummer wird `1OG-100`; ein ungepflegter Plan vererbt
  nichts und die Nummer bleibt `101`; leere Werte und fehlende Felder werden
  übersprungen; der Rückfall über das Label findet umbenannte Felder;
  nachträgliches Bearbeiten wirkt sofort auf Reiter und Vererbung.
* **Standort ohne Foto, Folgewirkung** (Browser): ZIP-Export läuft trotz eines
  Standorts ohne Bild durch und enthält genau die Dateien des Standorts MIT
  Foto; die Karte zeigt den Hinweis, der Klick öffnet die Auswahl statt eines
  leeren Editors, Hochladen führt in den Editor mit Bild, Speichern setzt das
  Hauptbild des bestehenden Standorts (4974 Bytes in IndexedDB) ohne die
  Standortzahl zu verändern.
* **Standortnummern** (Node, 30 Fälle + Browser): alle Geschossmuster inkl.
  Schreibvarianten; Rückwärtskompatibilität aller Zerleger (`nextLocationNumber`
  liest „EG-109" als 109, gemischt mit Altformat „WER-1234-105"); Marker und
  PDF-Export kürzen weiterhin korrekt. End-to-End: „Erdgeschoss" → EG-100,
  „1. OG" → 1OG-101, ohne Geschoss → 102, Nummern eindeutig und projektweit
  aufsteigend, Marker zeigen weiter die kurze Nummer. Vorbelegung greift bei
  „Haus A - 1. OG" und bleibt bei „Grundriss" leer.
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
   mit 150 Markern tritt das aber genauso auf. **Teilweise erledigt:** der
   Grundriss lässt sich jetzt bis 8× vergrößern, damit sind eng beieinander
   liegende Marker einzeln antippbar. Zwei Marker auf demselben Punkt trennt
   das aber nicht – ob sie zusätzlich aufgefächert werden müssen, zeigt der
   erste echte Plan.
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
