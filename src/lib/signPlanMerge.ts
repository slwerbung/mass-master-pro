import { SignPlanData, SignRecord, SignCollection, SIGN_COLLECTIONS } from '@/types/signPlan';

/**
 * Konfliktaufloesung des Leitsystem-Syncs – bewusst frei von Supabase und
 * IndexedDB, damit sich die Regeln isoliert nachvollziehen und pruefen lassen.
 */

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

export const time = (iso: string | null | undefined): number => {
  const parsed = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

export interface MergePlan {
  merged: SignRecord[];
  toUpload: SignRecord[];
  toDelete: string[];
}

/**
 * Fuehrt eine Sammlung zusammen. `lastSyncedAt` unterscheidet "remote noch
 * nicht gesehen" von "remote inzwischen geloescht" – ohne diesen Stempel
 * wuerde jede fremde Loeschung beim naechsten Sync rueckgaengig gemacht.
 */
export function mergeCollection(local: SignRecord[], remote: SignRecord[], lastSyncedAt: number): MergePlan {
  const remoteById = new Map(remote.map((record) => [record.id, record]));
  const localById = new Map(local.map((record) => [record.id, record]));

  const merged: SignRecord[] = [];
  const toUpload: SignRecord[] = [];
  const toDelete: string[] = [];

  for (const localRecord of local) {
    const remoteRecord = remoteById.get(localRecord.id);

    if (!remoteRecord) {
      if (localRecord.deletedAt) {
        // Loeschung ist auf beiden Seiten vollzogen. Der Grabstein bleibt
        // noch eine Weile liegen (siehe pruneTombstones).
        merged.push(localRecord);
      } else if (time(localRecord.updatedAt) > lastSyncedAt) {
        // Lokal neu angelegt, remote noch nie gesehen.
        merged.push(localRecord);
        toUpload.push(localRecord);
      }
      // sonst: war schon einmal synchron und ist remote geloescht worden –
      // faellt hier bewusst weg.
      continue;
    }

    if (localRecord.deletedAt && time(localRecord.updatedAt) >= time(remoteRecord.updatedAt)) {
      toDelete.push(localRecord.id);
      merged.push(localRecord);
      continue;
    }

    if (time(localRecord.updatedAt) > time(remoteRecord.updatedAt)) {
      merged.push(localRecord);
      toUpload.push(localRecord);
    } else {
      merged.push(remoteRecord);
    }
  }

  for (const remoteRecord of remote) {
    if (!localById.has(remoteRecord.id)) merged.push(remoteRecord);
  }

  return { merged, toUpload, toDelete };
}

export function pruneTombstones(data: SignPlanData): void {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const target = data as unknown as Record<SignCollection, SignRecord[]>;
  for (const collection of SIGN_COLLECTIONS) {
    target[collection] = target[collection].filter(
      (record) => !record.deletedAt || time(record.deletedAt) > cutoff,
    );
  }
}
