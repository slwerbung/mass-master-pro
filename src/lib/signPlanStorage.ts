import { openDB, deleteDB, DBSchema, IDBPDatabase } from 'idb';
import {
  SignPlanData, SignRecord, SignCollection, emptySignPlanData, SIGN_COLLECTIONS,
} from '@/types/signPlan';

/**
 * Lokaler Speicher des Leitsystem-Moduls.
 *
 * Bewusst eine EIGENE IndexedDB-Datenbank statt neuer Stores in `aufmass-db`:
 * der Prototyp aendert sein Schema noch, und ein fehlgeschlagenes
 * Versions-Upgrade der Hauptdatenbank wuerde Mitarbeiter von ihren echten
 * Aufmassen aussperren. Beide Datenbanken zusammenzulegen ist spaeter ein
 * kleiner Schritt (ein Store, ein Version-Bump) – der umgekehrte Weg nicht.
 *
 * Ein Datensatz je Projekt: der komplette Leitsystem-Bestand als JSON. Bei
 * den erwarteten Groessen (300 Positionen, ~10 Typen) ist das ein paar
 * hundert Kilobyte und in einem Rutsch gelesen schneller als zehn Indizes.
 * Die Konfliktaufloesung bleibt trotzdem feingranular, weil JEDER Datensatz
 * im JSON seinen eigenen `updatedAt` traegt (siehe signPlanSync.ts).
 */

interface SignPlanDBSchema extends DBSchema {
  'sign-plans': {
    key: string;
    value: {
      projectId: string;
      data: SignPlanData;
      /** Letzter erfolgreicher Sync mit Supabase (ISO) – oder null. */
      lastSyncedAt: string | null;
      updatedAt: string;
    };
  };
}

const DB_NAME = 'mmp-signplan-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<SignPlanDBSchema> | null = null;

function createDB() {
  return openDB<SignPlanDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('sign-plans')) {
        db.createObjectStore('sign-plans', { keyPath: 'projectId' });
      }
    },
  });
}

async function getDB(): Promise<IDBPDatabase<SignPlanDBSchema>> {
  if (dbInstance) return dbInstance;
  try {
    dbInstance = await createDB();
  } catch (err: unknown) {
    if ((err as { name?: string } | null)?.name === 'VersionError') {
      // Gleiche Notfallbehandlung wie in indexedDBStorage: lieber neu
      // aufbauen als die App blockieren. Der naechste Sync holt den Stand
      // aus Supabase zurueck.
      console.warn('SignPlan IndexedDB VersionError – Datenbank wird neu angelegt');
      await deleteDB(DB_NAME);
      dbInstance = await createDB();
    } else {
      throw err;
    }
  }
  return dbInstance;
}

/**
 * Fehlende Sammlungen auffuellen. Schuetzt vor Datensaetzen, die vor dem
 * Hinzufuegen einer Sammlung geschrieben wurden.
 */
function normalise(data: Partial<SignPlanData> | undefined): SignPlanData {
  const base = emptySignPlanData();
  if (!data) return base;
  const source = data as Partial<Record<SignCollection, unknown>>;
  const target = base as unknown as Record<SignCollection, unknown[]>;
  for (const key of SIGN_COLLECTIONS) {
    const value = source[key];
    target[key] = Array.isArray(value) ? value : [];
  }
  return base;
}

export async function loadSignPlan(projectId: string): Promise<SignPlanData> {
  const db = await getDB();
  const record = await db.get('sign-plans', projectId);
  return normalise(record?.data);
}

export async function saveSignPlan(projectId: string, data: SignPlanData): Promise<void> {
  const db = await getDB();
  const existing = await db.get('sign-plans', projectId);
  await db.put('sign-plans', {
    projectId,
    data: normalise(data),
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export async function getLastSyncedAt(projectId: string): Promise<string | null> {
  const db = await getDB();
  const record = await db.get('sign-plans', projectId);
  return record?.lastSyncedAt ?? null;
}

export async function setLastSyncedAt(projectId: string, iso: string): Promise<void> {
  const db = await getDB();
  const record = await db.get('sign-plans', projectId);
  if (!record) return;
  await db.put('sign-plans', { ...record, lastSyncedAt: iso });
}

/** Projekte, fuer die lokal ueberhaupt Leitsystem-Daten liegen. */
export async function getSignPlanProjectIds(): Promise<string[]> {
  const db = await getDB();
  return (await db.getAllKeys('sign-plans')) as string[];
}

export async function deleteSignPlan(projectId: string): Promise<void> {
  const db = await getDB();
  await db.delete('sign-plans', projectId);
}

// ─── Mutationen ─────────────────────────────────────────────────────────────

/**
 * Liest, veraendert und schreibt den Bestand eines Projekts in einem Zug.
 * Alle Schreibwege des Moduls laufen hierueber, damit nie zwei Aufrufer auf
 * einem veralteten Snapshot arbeiten.
 */
export async function mutateSignPlan(
  projectId: string,
  mutate: (data: SignPlanData) => void,
): Promise<SignPlanData> {
  const db = await getDB();
  const tx = db.transaction('sign-plans', 'readwrite');
  const existing = await tx.store.get(projectId);
  const data = normalise(existing?.data);
  mutate(data);
  await tx.store.put({
    projectId,
    data,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    updatedAt: new Date().toISOString(),
  });
  await tx.done;
  return data;
}

/** Grundgeruest eines neuen Datensatzes. */
export function newSignRecord(projectId: string): SignRecord {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), projectId, createdAt: now, updatedAt: now, deletedAt: null };
}

/** Datensatz einfuegen oder ersetzen; stempelt `updatedAt` neu. */
export function upsertRecord<K extends SignCollection>(
  data: SignPlanData,
  collection: K,
  record: SignPlanData[K][number],
): void {
  const list = data[collection] as SignRecord[];
  const stamped = { ...(record as SignRecord), updatedAt: new Date().toISOString() };
  const index = list.findIndex((item) => item.id === stamped.id);
  if (index >= 0) list[index] = stamped;
  else list.push(stamped);
}

/**
 * Loeschen heisst Grabstein setzen, nicht entfernen: sonst kaeme der
 * Datensatz beim naechsten Sync aus Supabase zurueck.
 */
export function removeRecord(
  data: SignPlanData,
  collection: SignCollection,
  id: string,
): void {
  const list = data[collection] as SignRecord[];
  const record = list.find((item) => item.id === id);
  if (!record) return;
  const now = new Date().toISOString();
  record.deletedAt = now;
  record.updatedAt = now;
}
