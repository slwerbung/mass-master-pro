/**
 * Datenmodell fuer das Leitsystem-Modul ("Aufmass mit Plan").
 *
 * Jeder Datensatz traegt `updatedAt` und optional `deletedAt`. Der Sync
 * vergleicht pro Datensatz, nicht pro Projekt – zwei Leute koennen also am
 * selben Projekt an verschiedenen Positionen arbeiten, ohne sich gegenseitig
 * zu ueberschreiben. Geloescht wird lokal als Grabstein (`deletedAt`), damit
 * eine Loeschung den Weg zur Gegenseite findet und nicht beim naechsten Sync
 * wieder auftaucht.
 */

export type SignPositionStatus =
  | 'geplant'
  | 'freigegeben'
  | 'bestellt'
  | 'produziert'
  | 'montiert'
  | 'abgenommen'
  | 'entfallen';

export const SIGN_POSITION_STATUSES: SignPositionStatus[] = [
  'geplant', 'freigegeben', 'bestellt', 'produziert', 'montiert', 'abgenommen', 'entfallen',
];

export const SIGN_STATUS_LABELS: Record<SignPositionStatus, string> = {
  geplant: 'Geplant',
  freigegeben: 'Freigegeben',
  bestellt: 'Bestellt',
  produziert: 'Produziert',
  montiert: 'Montiert',
  abgenommen: 'Abgenommen',
  entfallen: 'Entfallen',
};

export type SignArrowDirection =
  | 'none' | 'up' | 'down' | 'left' | 'right'
  | 'up_left' | 'up_right' | 'down_left' | 'down_right';

export const SIGN_ARROWS: { value: SignArrowDirection; label: string; glyph: string }[] = [
  { value: 'none',       label: 'Kein Pfeil',      glyph: '–'  },
  { value: 'up',         label: 'Geradeaus',       glyph: '↑'  },
  { value: 'down',       label: 'Zurueck',         glyph: '↓'  },
  { value: 'left',       label: 'Links',           glyph: '←'  },
  { value: 'right',      label: 'Rechts',          glyph: '→'  },
  { value: 'up_left',    label: 'Links voraus',    glyph: '↖'  },
  { value: 'up_right',   label: 'Rechts voraus',   glyph: '↗'  },
  { value: 'down_left',  label: 'Links zurueck',   glyph: '↙'  },
  { value: 'down_right', label: 'Rechts zurueck',  glyph: '↘'  },
];

/** Gemeinsame Felder aller Leitsystem-Datensaetze. */
export interface SignRecord {
  id: string;
  projectId: string;
  /** ISO-Zeitstempel der letzten Aenderung. Basis des Merge beim Sync. */
  updatedAt: string;
  /** Grabstein. Gesetzt = geloescht; der Datensatz bleibt bis zum Sync liegen. */
  deletedAt?: string | null;
  createdAt: string;
}

export interface SignBuilding extends SignRecord {
  name: string;
  sortOrder: number;
}

export interface SignFloor extends SignRecord {
  buildingId: string | null;
  name: string;
  /** Kuerzel fuer die Positionsnummer, z.B. "EG", "1OG". */
  code: string;
  /** Sortierung von unten nach oben: UG = -1, EG = 0, 1.OG = 1 ... */
  level: number;
}

/** Zuordnung eines vorhandenen Grundrisses (floor_plans) zu einem Geschoss. */
export interface SignFloorPlanLink extends SignRecord {
  floorPlanId: string;
  floorId: string;
}

export interface SignType extends SignRecord {
  code: string;
  name: string;
  widthMm: number | null;
  heightMm: number | null;
  material: string;
  mounting: string;
  unitPrice: number | null;
  /** Fabrikatsneutraler Beschreibungstext fuer das spaetere LV. */
  descriptionNeutral: string;
  manufacturer: string;
  articleNumber: string;
  /** Markerfarbe im Plan (#rrggbb). */
  color: string;
  sortOrder: number;
}

export interface SignPosition extends SignRecord {
  floorId: string | null;
  positionNumber: string;
  title: string;
  status: SignPositionStatus;
  isAddition: boolean;
  note: string;
  /** Optionale Bruecke in die bestehende Standorterfassung (Foto/Kommentar). */
  locationId: string | null;
}

export interface SignPositionType extends SignRecord {
  positionId: string;
  signTypeId: string;
  quantity: number;
}

export interface SignPlanMarker extends SignRecord {
  floorPlanId: string;
  positionId: string;
  /** Relativ 0..1, damit Zoomstufe und Planformat egal sind. */
  x: number;
  y: number;
}

export interface SignDestination extends SignRecord {
  name: string;
  nameSecondary: string;
  sortOrder: number;
}

export interface SignLabelLine extends SignRecord {
  /** Beschriftung haengt am Schild (Position + Typ), nicht an der Position. */
  positionTypeId: string;
  sortOrder: number;
  destinationId: string | null;
  /** Ausnahme: weicht vom Zielverzeichnis ab. Leer = Ziel gilt. */
  textOverride: string;
  textSecondary: string;
  arrow: SignArrowDirection;
  pictogram: string;
  isTactile: boolean;
  isBraille: boolean;
}

export interface SignQrToken extends SignRecord {
  positionId: string;
  token: string;
}

/** Der komplette Leitsystem-Datenbestand eines Projekts. */
export interface SignPlanData {
  buildings: SignBuilding[];
  floors: SignFloor[];
  floorPlanLinks: SignFloorPlanLink[];
  types: SignType[];
  positions: SignPosition[];
  positionTypes: SignPositionType[];
  markers: SignPlanMarker[];
  destinations: SignDestination[];
  labelLines: SignLabelLine[];
  qrTokens: SignQrToken[];
}

export const SIGN_COLLECTIONS = [
  'buildings', 'floors', 'floorPlanLinks', 'types', 'positions',
  'positionTypes', 'markers', 'destinations', 'labelLines', 'qrTokens',
] as const;

export type SignCollection = typeof SIGN_COLLECTIONS[number];

export function emptySignPlanData(): SignPlanData {
  return {
    buildings: [], floors: [], floorPlanLinks: [], types: [], positions: [],
    positionTypes: [], markers: [], destinations: [], labelLines: [], qrTokens: [],
  };
}

/** Nur die lebenden Datensaetze – Grabsteine bleiben fuer den Sync liegen. */
export function alive<T extends SignRecord>(items: T[]): T[] {
  return items.filter((item) => !item.deletedAt);
}
