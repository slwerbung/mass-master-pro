import {
  SignPlanData, SignPosition, SignType, SignFloor, SignBuilding,
  SignDestination, SignLabelLine, SignPositionType, alive,
} from '@/types/signPlan';

/**
 * Fachlogik des Leitsystem-Moduls: Positionsnummern, Stueckliste,
 * Textaufloesung. Bewusst frei von React und IndexedDB, damit sich die
 * Zahlen der Stueckliste unabhaengig von der Oberflaeche pruefen lassen.
 */

// ─── Positionsnummern ───────────────────────────────────────────────────────
//
// Aufbau: <Geschoss-Kuerzel>-<laufende Nummer, dreistellig>, z.B. "EG-001".
// Eindeutig je Projekt. Die Vergabe passiert im Client und NICHT per
// Datenbankfunktion – sonst liesse sich offline vor Ort keine Position
// anlegen, und genau dort entsteht sie.

const NUMBER_PAD = 3;

export function floorPrefix(floor: SignFloor | undefined | null): string {
  const code = (floor?.code || '').trim();
  if (code) return code.toUpperCase();
  return 'POS';
}

function parseSequence(positionNumber: string, prefix: string): number | null {
  if (!positionNumber.startsWith(`${prefix}-`)) return null;
  const tail = positionNumber.slice(prefix.length + 1);
  if (!/^\d+$/.test(tail)) return null;
  return parseInt(tail, 10);
}

export function formatPositionNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(NUMBER_PAD, '0')}`;
}

/**
 * Naechste freie Nummer im Geschoss. Zaehlt ueber die hoechste bereits
 * vergebene Nummer desselben Praefixes hoch – Luecken durch geloeschte
 * Positionen werden bewusst NICHT wiederverwendet, sonst bekaeme eine neue
 * Position die Nummer eines Schildes, das vielleicht schon produziert ist.
 */
export function nextPositionNumber(data: SignPlanData, floorId: string | null): string {
  const floor = alive(data.floors).find((f) => f.id === floorId);
  const prefix = floorPrefix(floor);
  let max = 0;
  for (const position of alive(data.positions)) {
    const sequence = parseSequence(position.positionNumber, prefix);
    if (sequence !== null && sequence > max) max = sequence;
  }
  return formatPositionNumber(prefix, max + 1);
}

export function isPositionNumberTaken(data: SignPlanData, number: string, exceptId?: string): boolean {
  return alive(data.positions).some(
    (p) => p.id !== exceptId && p.positionNumber.trim().toLowerCase() === number.trim().toLowerCase(),
  );
}

/**
 * Vergibt alle Nummern neu: nach Geschoss (von unten nach oben) und
 * innerhalb des Geschosses nach Anlagereihenfolge. Liefert die geaenderten
 * Positionen zurueck, damit der Aufrufer nur diese stempeln muss.
 */
export function renumberPositions(data: SignPlanData): { position: SignPosition; nextNumber: string }[] {
  const floors = sortedFloors(data);
  const floorOrder = new Map(floors.map((floor, index) => [floor.id, index]));
  const positions = [...alive(data.positions)].sort((a, b) => {
    const fa = a.floorId ? floorOrder.get(a.floorId) ?? 9999 : 9999;
    const fb = b.floorId ? floorOrder.get(b.floorId) ?? 9999 : 9999;
    if (fa !== fb) return fa - fb;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const counters = new Map<string, number>();
  const changes: { position: SignPosition; nextNumber: string }[] = [];
  for (const position of positions) {
    const floor = floors.find((f) => f.id === position.floorId);
    const prefix = floorPrefix(floor);
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    const nextNumber = formatPositionNumber(prefix, next);
    if (nextNumber !== position.positionNumber) changes.push({ position, nextNumber });
  }
  return changes;
}

// ─── Sortierung ─────────────────────────────────────────────────────────────

export function sortedBuildings(data: SignPlanData): SignBuilding[] {
  return [...alive(data.buildings)].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'),
  );
}

/** Geschosse: erst nach Gebaeude, dann von unten nach oben. */
export function sortedFloors(data: SignPlanData): SignFloor[] {
  const buildingOrder = new Map(sortedBuildings(data).map((b, index) => [b.id, index]));
  return [...alive(data.floors)].sort((a, b) => {
    const ba = a.buildingId ? buildingOrder.get(a.buildingId) ?? 9999 : 9999;
    const bb = b.buildingId ? buildingOrder.get(b.buildingId) ?? 9999 : 9999;
    if (ba !== bb) return ba - bb;
    return a.level - b.level || a.name.localeCompare(b.name, 'de');
  });
}

export function sortedTypes(data: SignPlanData): SignType[] {
  return [...alive(data.types)].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'de', { numeric: true }),
  );
}

export function sortedDestinations(data: SignPlanData): SignDestination[] {
  return [...alive(data.destinations)].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'),
  );
}

/**
 * Positionen in der Reihenfolge, in der man sie abgeht: erst nach Geschoss
 * (von unten nach oben), dann nach Nummer. Rein alphabetisch stuende sonst
 * "1OG-001" vor "EG-001".
 */
export function sortedPositions(data: SignPlanData): SignPosition[] {
  const floorOrder = new Map(sortedFloors(data).map((floor, index) => [floor.id, index]));
  return [...alive(data.positions)].sort((a, b) => {
    const fa = a.floorId ? floorOrder.get(a.floorId) ?? 9999 : 9999;
    const fb = b.floorId ? floorOrder.get(b.floorId) ?? 9999 : 9999;
    if (fa !== fb) return fa - fb;
    return a.positionNumber.localeCompare(b.positionNumber, 'de', { numeric: true, sensitivity: 'base' });
  });
}

// ─── Verknuepfungen ─────────────────────────────────────────────────────────

export function typesOfPosition(data: SignPlanData, positionId: string): SignPositionType[] {
  return alive(data.positionTypes).filter((pt) => pt.positionId === positionId);
}

export function labelLinesOfPositionType(data: SignPlanData, positionTypeId: string): SignLabelLine[] {
  return alive(data.labelLines)
    .filter((line) => line.positionTypeId === positionTypeId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Der Text, der auf dem Schild steht. Regel: das Zielverzeichnis gewinnt,
 * damit ein Umbenennen ueberall ankommt. `textOverride` ist die bewusste
 * Ausnahme und schlaegt das Ziel.
 */
export function resolveLineText(line: SignLabelLine, destinations: SignDestination[]): string {
  if (line.textOverride.trim()) return line.textOverride.trim();
  const destination = destinations.find((d) => d.id === line.destinationId);
  return destination?.name ?? '';
}

export function resolveLineTextSecondary(line: SignLabelLine, destinations: SignDestination[]): string {
  if (line.textSecondary.trim()) return line.textSecondary.trim();
  const destination = destinations.find((d) => d.id === line.destinationId);
  return destination?.nameSecondary ?? '';
}

/** Wie oft wird dieses Ziel im Projekt verwendet? Fuer "Umbenennen wirkt wo?" */
export function destinationUsageCount(data: SignPlanData, destinationId: string): number {
  return alive(data.labelLines).filter((line) => line.destinationId === destinationId).length;
}

/** Der Typ, dessen Farbe der Marker traegt: der erste Typ der Position. */
export function primaryTypeOfPosition(data: SignPlanData, positionId: string): SignType | undefined {
  const order = sortedTypes(data);
  const assigned = typesOfPosition(data, positionId);
  for (const type of order) {
    if (assigned.some((pt) => pt.signTypeId === type.id)) return type;
  }
  return undefined;
}

// ─── Stueckliste ────────────────────────────────────────────────────────────

export interface BoqRow {
  signTypeId: string;
  code: string;
  name: string;
  widthMm: number | null;
  heightMm: number | null;
  material: string;
  mounting: string;
  unitPrice: number | null;
  isAddition: boolean;
  quantity: number;
  /** Gesamtflaeche in m2 (Breite x Hoehe x Menge). */
  areaSqm: number;
  /** Gesamtpreis; null, wenn am Typ kein Preis hinterlegt ist. */
  totalPrice: number | null;
}

export interface BoqTotals {
  quantity: number;
  areaSqm: number;
  totalPrice: number;
}

/**
 * Stueckliste, gruppiert nach Typ. Nachtraege werden als eigene Zeilen
 * gefuehrt, damit sie separat ausgewiesen werden koennen.
 *
 * Entfallene Positionen zaehlen nicht mit – sie sind gestrichen, nicht
 * bestellt. Dieselbe Regel steht in der Datenbank-View
 * `sign_bill_of_quantities`, damit App und Server dieselben Zahlen liefern.
 */
export function buildBoq(data: SignPlanData): BoqRow[] {
  const positionsById = new Map(alive(data.positions).map((p) => [p.id, p]));
  const typesById = new Map(alive(data.types).map((t) => [t.id, t]));
  const rows = new Map<string, BoqRow>();

  for (const link of alive(data.positionTypes)) {
    const position = positionsById.get(link.positionId);
    const type = typesById.get(link.signTypeId);
    if (!position || !type) continue;
    if (position.status === 'entfallen') continue;

    const key = `${type.id}|${position.isAddition ? '1' : '0'}`;
    const existing = rows.get(key);
    const area = ((type.widthMm ?? 0) * (type.heightMm ?? 0) * link.quantity) / 1_000_000;
    if (existing) {
      existing.quantity += link.quantity;
      existing.areaSqm += area;
      if (type.unitPrice !== null) existing.totalPrice = (existing.totalPrice ?? 0) + type.unitPrice * link.quantity;
    } else {
      rows.set(key, {
        signTypeId: type.id,
        code: type.code,
        name: type.name,
        widthMm: type.widthMm,
        heightMm: type.heightMm,
        material: type.material,
        mounting: type.mounting,
        unitPrice: type.unitPrice,
        isAddition: position.isAddition,
        quantity: link.quantity,
        areaSqm: area,
        totalPrice: type.unitPrice !== null ? type.unitPrice * link.quantity : null,
      });
    }
  }

  const typeOrder = new Map(sortedTypes(data).map((t, index) => [t.id, index]));
  return [...rows.values()].sort((a, b) => {
    if (a.isAddition !== b.isAddition) return a.isAddition ? 1 : -1;
    return (typeOrder.get(a.signTypeId) ?? 9999) - (typeOrder.get(b.signTypeId) ?? 9999);
  });
}

export function boqTotals(rows: BoqRow[]): BoqTotals {
  return rows.reduce<BoqTotals>(
    (acc, row) => ({
      quantity: acc.quantity + row.quantity,
      areaSqm: acc.areaSqm + row.areaSqm,
      totalPrice: acc.totalPrice + (row.totalPrice ?? 0),
    }),
    { quantity: 0, areaSqm: 0, totalPrice: 0 },
  );
}

/** Anzahl Schilder einer Position (Summe der Mengen ueber alle Typen). */
export function signCountOfPosition(data: SignPlanData, positionId: string): number {
  return typesOfPosition(data, positionId).reduce((sum, pt) => sum + pt.quantity, 0);
}

export const formatNumber = (value: number, digits = 2): string =>
  value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatEuro = (value: number | null): string =>
  value === null ? '' : `${formatNumber(value)} €`;

// ─── Filter ─────────────────────────────────────────────────────────────────

export const ALL = 'all';

export interface SignPositionFilter {
  floorId: string;
  typeId: string;
  status: string;
  search: string;
}

export const emptyFilter = (): SignPositionFilter => ({
  floorId: ALL, typeId: ALL, status: ALL, search: '',
});

export function isFilterActive(filter: SignPositionFilter): boolean {
  return filter.floorId !== ALL || filter.typeId !== ALL || filter.status !== ALL || !!filter.search.trim();
}

/**
 * Filtert Positionen. Die Typ-Zuordnungen werden einmal vorindiziert, damit
 * die Funktion auch bei 300 Positionen nicht ueber alle Zuordnungen scannt –
 * der Plan filtert bei jedem Tastendruck neu.
 */
export function filterPositions(data: SignPlanData, filter: SignPositionFilter): SignPosition[] {
  const typesByPosition = new Map<string, Set<string>>();
  for (const link of alive(data.positionTypes)) {
    const set = typesByPosition.get(link.positionId) ?? new Set<string>();
    set.add(link.signTypeId);
    typesByPosition.set(link.positionId, set);
  }
  const needle = filter.search.trim().toLowerCase();

  return sortedPositions(data).filter((position) => {
    if (filter.floorId !== ALL && position.floorId !== filter.floorId) return false;
    if (filter.status !== ALL && position.status !== filter.status) return false;
    if (filter.typeId !== ALL && !typesByPosition.get(position.id)?.has(filter.typeId)) return false;
    if (needle) {
      const haystack = `${position.positionNumber} ${position.title} ${position.note}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}
