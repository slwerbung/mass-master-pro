// Pure, framework-agnostic types for the foil-cutting nesting feature.
// No React/React-Native imports here on purpose — this stays runnable and
// testable under plain Node.

/** A part to be cut (from the area measurements / Flächenaufmaß). */
export interface Teil {
  /** Label, e.g. "F1". */
  label: string;
  /** Raw dimensions in mm, before Zugabe. */
  breite: number;
  hoehe: number;
  /** True when this part is a strip produced by splitting an oversized area. */
  gestueckelt?: boolean;
}

/** What the auto-width chooser optimizes for. */
export type Optimierung = "flaeche" | "laenge";

/** How an oversized area is split so it fits the foil width.
 *  "gleich"  = equal-width strips (n = ceil(dim / usable)).
 *  "rest"    = full foil-width strips + one remainder strip. */
export type StueckelModus = "gleich" | "rest";

/** Nesting parameters. */
export interface NestingOptions {
  /** Fixed foil width in mm. Ignored when autoBreite = true. */
  folienbreite: number;         // e.g. 1370
  /** Automatic width choice from breitenKandidaten. */
  autoBreite: boolean;          // Default true
  /** Candidate foil widths in mm for the auto choice. */
  breitenKandidaten: number[];  // Default [1000, 1370, 1520]
  /** Zugabe ringsum in mm (added twice to width and height). */
  zugabe: number;               // Default 0

  /** Margin to the foil edge in mm. */
  rand: number;                 // Default 20
  /** Horizontal gap between parts in mm. */
  abstand: number;              // Default 5
  /** Vertical gap between rows in mm (room for labels). */
  reihenAbstand: number;        // Default 40
  /** Baseline offset of the label text below the part's bottom edge in mm. */
  textAbstand: number;          // Default 25
  /** Font size of the label (SVG units = mm). */
  schriftgroesse: number;       // Default 20

  /** Sort parts by height descending before packing (less waste). */
  sortieren: boolean;           // Default true

  /** Auto-width optimization criterion. Default "laenge". */
  optimierung: Optimierung;

  /** Split areas that are too wide for the foil into fitting strips. Default true. */
  stueckeln: boolean;
  /** How to split (equal strips vs foil-width + remainder). Default "gleich". */
  stueckelModus: StueckelModus;

  /** Project number, written once into the page corner; empty = no output. */
  projektnummer?: string;
}

export interface PlatziertesTeil extends Teil {
  x: number;        // left edge (mm)
  y: number;        // top edge (mm, usually <= 0)
  pBreite: number;  // effective width after Zugabe + optional rotation
  pHoehe: number;   // effective height after Zugabe + optional rotation
  gedreht: boolean;
  zuGross: boolean; // does not fit into the foil width even rotated
}

export interface PackResult {
  teile: PlatziertesTeil[];
  laengeMm: number;      // required foil length
  folienbreite: number;
  flaecheM2: number;     // folienbreite * laenge
}

export interface FolienMenge {
  nettoFlaecheM2: number;    // sum of RAW part areas (= today's display)
  zugabeFlaecheM2: number;   // sum of part areas incl. Zugabe ringsum
  laufmeter: number;         // required length in running metres
  bruttoFlaecheM2: number;   // folienbreite × length = real foil amount
  verschnittM2: number;      // brutto − netto
  verschnittProzent: number; // (brutto−netto)/brutto
  ausnutzungProzent: number; // netto/brutto
  mehrbedarfProzent: number; // (brutto/netto − 1)
}

export interface MengenOptions {
  /** Percentage safety margin on the length, e.g. 0.05 = 5 %. */
  sicherheitszuschlag: number;   // Default 0
}
