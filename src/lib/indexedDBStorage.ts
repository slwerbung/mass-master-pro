import { openDB, deleteDB, DBSchema, IDBPDatabase } from 'idb';
import { Project, Location, DetailImage, FloorPlan } from '@/types/project';
import type { Session } from '@/lib/session';


const parseStoredDateSafe = (value: unknown, fallback: Date = new Date(0)): Date => {
  if (value instanceof Date) return isNaN(value.getTime()) ? fallback : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? fallback : d;
  }
  return fallback;
};

interface AufmassDBSchema extends DBSchema {
  projects: {
    key: string;
    value: {
      id: string;
      projectNumber: string;
      projectType?: 'aufmass' | 'aufmass_mit_plan';
      employeeId?: string | null;
      accessEmployeeIds?: string[];
      createdAt: string;
      updatedAt: string;
    };
    indexes: { 'by-updated': string; 'by-access-employee': string };
  };
  locations: {
    key: string;
    value: {
      id: string;
      projectId: string;
      locationNumber: string;
      locationName?: string;
      comment?: string;
      system?: string;
      label?: string;
      locationType?: string;
      customFields?: string;
      guestInfo?: string;
      areaMeasurements?: string;
      createdAt: string;
    };
    indexes: { 'by-project': string };
  };
  images: {
    key: string;
    value: {
      id: string;
      locationId: string;
      type: 'annotated' | 'original';
      blob: Blob;
    };
    indexes: { 'by-location': string };
  };
  'detail-images': {
    key: string;
    value: {
      id: string;
      locationId: string;
      caption?: string;
      createdAt: string;
    };
    indexes: { 'by-location': string };
  };
  'detail-image-blobs': {
    key: string;
    value: {
      id: string;
      detailImageId: string;
      type: 'annotated' | 'original';
      blob: Blob;
    };
    indexes: { 'by-detail-image': string };
  };
  'floor-plans': {
    key: string;
    value: {
      id: string;
      projectId: string;
      name: string;
      pageIndex: number;
      markers: string; // JSON stringified FloorPlanMarker[]
      createdAt: string;
    };
    indexes: { 'by-project': string };
  };
  'floor-plan-images': {
    key: string;
    value: {
      id: string;
      floorPlanId: string;
      blob: Blob;
    };
    indexes: { 'by-floor-plan': string };
  };
}

const DB_NAME = 'aufmass-db';
const DB_VERSION = 6;

let dbInstance: IDBPDatabase<AufmassDBSchema> | null = null;

function createDB() {
  return openDB<AufmassDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
        projectStore.createIndex('by-updated', 'updatedAt');

        const locationStore = db.createObjectStore('locations', { keyPath: 'id' });
        locationStore.createIndex('by-project', 'projectId');

        const imageStore = db.createObjectStore('images', { keyPath: 'id' });
        imageStore.createIndex('by-location', 'locationId');
      }
      if (oldVersion < 2) {
        const detailStore = db.createObjectStore('detail-images', { keyPath: 'id' });
        detailStore.createIndex('by-location', 'locationId');

        const detailBlobStore = db.createObjectStore('detail-image-blobs', { keyPath: 'id' });
        detailBlobStore.createIndex('by-detail-image', 'detailImageId');
      }
      if (oldVersion < 3) {
        const floorPlanStore = db.createObjectStore('floor-plans', { keyPath: 'id' });
        floorPlanStore.createIndex('by-project', 'projectId');

        const floorPlanImageStore = db.createObjectStore('floor-plan-images', { keyPath: 'id' });
        floorPlanImageStore.createIndex('by-floor-plan', 'floorPlanId');
      }
      if (oldVersion < 5) {
        const projectStore = oldVersion < 1 ? transaction.objectStore('projects') : transaction.objectStore('projects');
        if (!projectStore.indexNames.contains('by-access-employee')) {
          projectStore.createIndex('by-access-employee', 'accessEmployeeIds', { multiEntry: true });
        }
      }
    },
  });
}

async function getDB(): Promise<IDBPDatabase<AufmassDBSchema>> {
  if (dbInstance) return dbInstance;

  try {
    dbInstance = await createDB();
  } catch (err: any) {
    if (err?.name === 'VersionError') {
      console.warn('IndexedDB VersionError – deleting and recreating database');
      await deleteDB(DB_NAME);
      dbInstance = await createDB();
    } else {
      throw err;
    }
  }

  return dbInstance;
}

// Convert base64 to Blob for efficient storage
function base64ToBlob(base64: string): Blob {
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1] || 'image/jpeg';
  const raw = atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
}

// Convert Blob back to base64 for display
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper to create image ID
function createImageId(locationId: string, type: 'annotated' | 'original'): string {
  return `${locationId}_${type}`;
}

function createDetailBlobId(detailImageId: string, type: 'annotated' | 'original'): string {
  return `${detailImageId}_${type}`;
}

function canAccessProjectRecord(record: { accessEmployeeIds?: string[]; employeeId?: string | null }, session?: Session | null): boolean {
  if (!session || session.role === 'admin') return true;
  if (session.role !== 'employee') return true;
  const accessIds = Array.isArray(record.accessEmployeeIds) ? record.accessEmployeeIds : [];
  if (accessIds.length > 0) return accessIds.includes(session.id);
  return !!record.employeeId && record.employeeId === session.id;
}


async function getAccessibleProjectRecords(db: IDBPDatabase<AufmassDBSchema>, session?: Session | null) {
  if (session?.role !== "employee") return db.getAll('projects');
  try {
    return await db.getAllFromIndex('projects', 'by-access-employee', session.id);
  } catch (err) {
    console.warn("IndexedDB by-access-employee index unavailable, falling back to full scan", err);
    const all = await db.getAll('projects');
    return all.filter((record) => canAccessProjectRecord(record, session));
  }
}

function normaliseAccessEmployeeIds(employeeId?: string | null, assignedEmployeeIds?: string[]) {
  const ids = new Set<string>();
  if (employeeId) ids.add(employeeId);
  for (const id of assignedEmployeeIds || []) {
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export const indexedDBStorage = {
  // Lightweight: returns only metadata + location count, NO images loaded
  async getProjectsSummary(session?: Session | null): Promise<{ id: string; projectNumber: string; createdAt: Date; locationCount: number }[]> {
    const db = await getDB();
    const records = await getAccessibleProjectRecords(db, session);
    const result = [];
    for (const r of records) {
      const keys = await db.getAllKeysFromIndex('locations', 'by-project', r.id);
      result.push({
        id: r.id,
        projectNumber: r.projectNumber,
        createdAt: new Date(r.createdAt),
        locationCount: keys.length,
      });
    }
    return result;
  },

  // Returns just project IDs for sync without loading any data
  async getProjectIds(session?: Session | null): Promise<string[]> {
    const db = await getDB();
    const records = await getAccessibleProjectRecords(db, session);
    return records.map((record) => record.id);
  },
  // Update only the project timestamp without touching locations/images
  async updateProjectTimestamp(projectId: string, timestamp: string): Promise<void> {
    const db = await getDB();
    const record = await db.get('projects', projectId);
    if (record) {
      await db.put('projects', { ...record, updatedAt: timestamp });
    }
  },

  async getProjects(session?: Session | null): Promise<Project[]> {
    const db = await getDB();
    const projectRecords = await getAccessibleProjectRecords(db, session);
    
    const projects: Project[] = [];
    
    for (const record of projectRecords) {
      const locations = await this.getLocationsByProject(record.id);
      const floorPlans = await this.getFloorPlansByProject(record.id);
      projects.push({
        id: record.id,
        projectNumber: record.projectNumber,
        projectType: record.projectType,
        employeeId: record.employeeId ?? null,
        accessEmployeeIds: Array.isArray(record.accessEmployeeIds) ? record.accessEmployeeIds : normaliseAccessEmployeeIds(record.employeeId),
        createdAt: parseStoredDateSafe(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        locations,
        floorPlans,
      });
    }
    
    return projects;
  },

  async getProject(id: string, session?: Session | null): Promise<Project | null> {
    const db = await getDB();
    const record = await db.get('projects', id);
    
    if (!record || !canAccessProjectRecord(record, session)) return null;
    
    const locations = await this.getLocationsByProject(id);
    const floorPlans = await this.getFloorPlansByProject(id);
    
    return {
      id: record.id,
      projectNumber: record.projectNumber,
      projectType: record.projectType,
      employeeId: record.employeeId ?? null,
      accessEmployeeIds: Array.isArray(record.accessEmployeeIds) ? record.accessEmployeeIds : normaliseAccessEmployeeIds(record.employeeId),
      createdAt: parseStoredDateSafe(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      locations,
      floorPlans,
    };
  },

  async getLocationsByProject(projectId: string): Promise<Location[]> {
    const db = await getDB();
    const locationRecords = await db.getAllFromIndex('locations', 'by-project', projectId);
    
    const locations: Location[] = [];
    
    for (const record of locationRecords) {
      const annotatedImageId = createImageId(record.id, 'annotated');
      const originalImageId = createImageId(record.id, 'original');
      
      const annotatedImage = await db.get('images', annotatedImageId);
      const originalImage = await db.get('images', originalImageId);
      
      const imageData = annotatedImage ? await blobToBase64(annotatedImage.blob) : '';
      const originalImageData = originalImage ? await blobToBase64(originalImage.blob) : imageData;

      // Load detail images
      const detailImages = await this.getDetailImagesByLocation(record.id);
      
      locations.push({
        id: record.id,
        locationNumber: record.locationNumber,
        locationName: record.locationName,
        comment: record.comment,
        system: record.system,
        label: record.label,
        locationType: record.locationType,
        customFields: record.customFields ? JSON.parse(record.customFields) : undefined,
        guestInfo: record.guestInfo,
        areaMeasurements: (record as any).areaMeasurements ? JSON.parse((record as any).areaMeasurements) : undefined,
        imageData,
        originalImageData,
        detailImages,
        createdAt: parseStoredDateSafe(record.createdAt),
      });
    }
    
    return locations;
  },

  async getDetailImagesByLocation(locationId: string): Promise<DetailImage[]> {
    const db = await getDB();
    const records = await db.getAllFromIndex('detail-images', 'by-location', locationId);
    
    const detailImages: DetailImage[] = [];
    
    for (const record of records) {
      const annotatedBlob = await db.get('detail-image-blobs', createDetailBlobId(record.id, 'annotated'));
      const originalBlob = await db.get('detail-image-blobs', createDetailBlobId(record.id, 'original'));
      
      const imageData = annotatedBlob ? await blobToBase64(annotatedBlob.blob) : '';
      const originalImageData = originalBlob ? await blobToBase64(originalBlob.blob) : imageData;
      
      detailImages.push({
        id: record.id,
        imageData,
        originalImageData,
        caption: record.caption,
        createdAt: parseStoredDateSafe(record.createdAt),
      });
    }
    
    return detailImages;
  },

  async saveDetailImage(locationId: string, detailImage: DetailImage): Promise<void> {
    const db = await getDB();
    
    await db.put('detail-images', {
      id: detailImage.id,
      locationId,
      caption: detailImage.caption,
      createdAt: detailImage.createdAt.toISOString(),
    });
    
    if (detailImage.imageData) {
      await db.put('detail-image-blobs', {
        id: createDetailBlobId(detailImage.id, 'annotated'),
        detailImageId: detailImage.id,
        type: 'annotated',
        blob: base64ToBlob(detailImage.imageData),
      });
    }
    
    if (detailImage.originalImageData) {
      await db.put('detail-image-blobs', {
        id: createDetailBlobId(detailImage.id, 'original'),
        detailImageId: detailImage.id,
        type: 'original',
        blob: base64ToBlob(detailImage.originalImageData),
      });
    }
  },

  async updateLocationImage(projectId: string, locationId: string, imageData: string): Promise<void> {
    const db = await getDB();
    await db.put('images', {
      id: createImageId(locationId, 'annotated'),
      locationId,
      type: 'annotated',
      blob: base64ToBlob(imageData),
    });
    const project = await db.get('projects', projectId);
    if (project) {
      await db.put('projects', { ...project, updatedAt: new Date().toISOString() });
    }
  },

  async updateDetailImage(detailImageId: string, imageData: string): Promise<void> {
    const db = await getDB();
    await db.put('detail-image-blobs', {
      id: createDetailBlobId(detailImageId, 'annotated'),
      detailImageId,
      type: 'annotated',
      blob: base64ToBlob(imageData),
    });
  },

  async updateDetailImageMetadata(detailImageId: string, data: { caption?: string }): Promise<void> {
    const db = await getDB();
    const record = await db.get('detail-images', detailImageId);
    if (!record) return;
    await db.put('detail-images', {
      ...record,
      caption: data.caption,
    });
  },

  async deleteDetailImage(detailImageId: string): Promise<void> {
    const db = await getDB();
    await db.delete('detail-images', detailImageId);
    await db.delete('detail-image-blobs', createDetailBlobId(detailImageId, 'annotated'));
    await db.delete('detail-image-blobs', createDetailBlobId(detailImageId, 'original'));
  },

  async updateLocationMetadata(projectId: string, locationId: string, data: { locationName?: string; comment?: string; system?: string; label?: string; locationType?: string; customFields?: Record<string, string>; guestInfo?: string; areaMeasurements?: { index: number; widthMm: number; heightMm: number }[] }): Promise<void> {
    const db = await getDB();
    const record = await db.get('locations', locationId);
    if (!record) return;
    
    const updates: any = {
      ...record,
      locationName: data.locationName,
      comment: data.comment,
      system: data.system,
      label: data.label,
      locationType: data.locationType,
      customFields: data.customFields ? JSON.stringify(data.customFields) : undefined,
      guestInfo: data.guestInfo,
    };
    if (data.areaMeasurements !== undefined) {
      updates.areaMeasurements = JSON.stringify(data.areaMeasurements);
    }
    await db.put('locations', updates);

    const project = await db.get('projects', projectId);
    if (project) {
      await db.put('projects', { ...project, updatedAt: new Date().toISOString() });
    }
  },

  async saveProject(project: Project): Promise<void> {
    const db = await getDB();
    
    await db.put('projects', {
      id: project.id,
      projectNumber: project.projectNumber,
      projectType: project.projectType,
      employeeId: project.employeeId ?? null,
      accessEmployeeIds: normaliseAccessEmployeeIds(project.employeeId, project.accessEmployeeIds),
      createdAt: project.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    });
    
    const existingLocations = await db.getAllFromIndex('locations', 'by-project', project.id);
    const existingLocationIds = new Set(existingLocations.map(l => l.id));
    
    for (const location of project.locations) {
      await db.put('locations', {
        id: location.id,
        projectId: project.id,
        locationNumber: location.locationNumber,
        locationName: location.locationName,
        comment: location.comment,
        system: location.system,
        label: location.label,
        locationType: location.locationType,
        customFields: location.customFields ? JSON.stringify(location.customFields) : undefined,
        guestInfo: location.guestInfo,
        areaMeasurements: location.areaMeasurements ? JSON.stringify(location.areaMeasurements) : undefined,
        createdAt: location.createdAt.toISOString(),
      });
      
      if (!existingLocationIds.has(location.id)) {
        if (location.imageData) {
          const annotatedBlob = base64ToBlob(location.imageData);
          await db.put('images', {
            id: createImageId(location.id, 'annotated'),
            locationId: location.id,
            type: 'annotated',
            blob: annotatedBlob,
          });
        }
        
        if (location.originalImageData) {
          const originalBlob = base64ToBlob(location.originalImageData);
          await db.put('images', {
            id: createImageId(location.id, 'original'),
            locationId: location.id,
            type: 'original',
            blob: originalBlob,
          });
        }
      }
    }
    
    for (const location of project.locations) {
      const currentDetailIds = new Set((location.detailImages || []).map(di => di.id));
      const existingDetailImages = await db.getAllFromIndex('detail-images', 'by-location', location.id);

      for (const detailImage of location.detailImages || []) {
        await this.saveDetailImage(location.id, detailImage);
      }

      for (const existingDetail of existingDetailImages) {
        if (!currentDetailIds.has(existingDetail.id)) {
          await db.delete('detail-image-blobs', createDetailBlobId(existingDetail.id, 'annotated'));
          await db.delete('detail-image-blobs', createDetailBlobId(existingDetail.id, 'original'));
          await db.delete('detail-images', existingDetail.id);
        }
      }
    }

    const existingFloorPlans = await db.getAllFromIndex('floor-plans', 'by-project', project.id);
    const currentFloorPlanIds = new Set((project.floorPlans || []).map(fp => fp.id));

    for (const floorPlan of project.floorPlans || []) {
      await this.saveFloorPlan(project.id, floorPlan);
    }

    for (const existingFloorPlan of existingFloorPlans) {
      if (!currentFloorPlanIds.has(existingFloorPlan.id)) {
        await db.delete('floor-plan-images', existingFloorPlan.id);
        await db.delete('floor-plans', existingFloorPlan.id);
      }
    }

    const currentLocationIds = new Set(project.locations.map(l => l.id));
    for (const existingLocation of existingLocations) {
      if (!currentLocationIds.has(existingLocation.id)) {
        const detailImages = await db.getAllFromIndex('detail-images', 'by-location', existingLocation.id);
        for (const di of detailImages) {
          await db.delete('detail-image-blobs', createDetailBlobId(di.id, 'annotated'));
          await db.delete('detail-image-blobs', createDetailBlobId(di.id, 'original'));
          await db.delete('detail-images', di.id);
        }
        await db.delete('locations', existingLocation.id);
        await db.delete('images', createImageId(existingLocation.id, 'annotated'));
        await db.delete('images', createImageId(existingLocation.id, 'original'));
      }
    }
  },

  // Floor Plan methods
  async getFloorPlansByProject(projectId: string): Promise<FloorPlan[]> {
    const db = await getDB();
    const records = await db.getAllFromIndex('floor-plans', 'by-project', projectId);
    
    const floorPlans: FloorPlan[] = [];
    
    for (const record of records) {
      const imageRecord = await db.get('floor-plan-images', record.id);
      const imageData = imageRecord ? await blobToBase64(imageRecord.blob) : '';
      
      floorPlans.push({
        id: record.id,
        name: record.name,
        imageData,
        markers: JSON.parse(record.markers),
        pageIndex: record.pageIndex,
        createdAt: parseStoredDateSafe(record.createdAt),
      });
    }
    
    return floorPlans.sort((a, b) => a.pageIndex - b.pageIndex);
  },

  async saveFloorPlan(projectId: string, floorPlan: FloorPlan): Promise<void> {
    const db = await getDB();
    
    await db.put('floor-plans', {
      id: floorPlan.id,
      projectId,
      name: floorPlan.name,
      pageIndex: floorPlan.pageIndex,
      markers: JSON.stringify(floorPlan.markers),
      createdAt: floorPlan.createdAt.toISOString(),
    });
    
    if (floorPlan.imageData) {
      await db.put('floor-plan-images', {
        id: floorPlan.id,
        floorPlanId: floorPlan.id,
        blob: base64ToBlob(floorPlan.imageData),
      });
    }

    const project = await db.get('projects', projectId);
    if (project) {
      await db.put('projects', { ...project, updatedAt: new Date().toISOString() });
    }
  },

  async updateFloorPlanMarkers(projectId: string, floorPlanId: string, markers: FloorPlan['markers']): Promise<void> {
    const db = await getDB();
    const record = await db.get('floor-plans', floorPlanId);
    if (!record) return;
    
    await db.put('floor-plans', {
      ...record,
      markers: JSON.stringify(markers),
    });

    const project = await db.get('projects', projectId);
    if (project) {
      await db.put('projects', { ...project, updatedAt: new Date().toISOString() });
    }
  },

  async deleteFloorPlan(floorPlanId: string): Promise<void> {
    const db = await getDB();
    await db.delete('floor-plans', floorPlanId);
    await db.delete('floor-plan-images', floorPlanId);
  },

  async deleteProject(id: string): Promise<void> {
    const db = await getDB();
    
    // Delete floor plans
    const floorPlans = await db.getAllFromIndex('floor-plans', 'by-project', id);
    for (const fp of floorPlans) {
      await db.delete('floor-plan-images', fp.id);
      await db.delete('floor-plans', fp.id);
    }
    
    const locations = await db.getAllFromIndex('locations', 'by-project', id);
    for (const location of locations) {
      const detailImages = await db.getAllFromIndex('detail-images', 'by-location', location.id);
      for (const di of detailImages) {
        await db.delete('detail-image-blobs', createDetailBlobId(di.id, 'annotated'));
        await db.delete('detail-image-blobs', createDetailBlobId(di.id, 'original'));
        await db.delete('detail-images', di.id);
      }
      await db.delete('images', createImageId(location.id, 'annotated'));
      await db.delete('images', createImageId(location.id, 'original'));
      await db.delete('locations', location.id);
    }
    
    await db.delete('projects', id);
  },

  async getStorageEstimate(): Promise<{ used: number; quota: number; percentage: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentage = quota > 0 ? (used / quota) * 100 : 0;
      return { used, quota, percentage };
    }
    return { used: 0, quota: 0, percentage: 0 };
  },

  async migrateFromLocalStorage(): Promise<boolean> {
    const STORAGE_KEY = 'aufmass_projects';
    const MIGRATED_KEY = 'aufmass_migrated_to_indexeddb';
    
    if (localStorage.getItem(MIGRATED_KEY)) {
      return false;
    }
    
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(MIGRATED_KEY, 'true');
      return false;
    }
    
    try {
      const projects = JSON.parse(data);
      
      for (const p of projects) {
        const project: Project = {
          id: p.id,
          projectNumber: p.projectNumber,
          createdAt: parseStoredDateSafe(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          locations: p.locations.map((l: any) => ({
            id: l.id,
            locationNumber: l.locationNumber,
            locationName: l.locationName,
            comment: l.comment,
            imageData: l.imageData,
            originalImageData: l.originalImageData,
            createdAt: parseStoredDateSafe(l.createdAt),
          })),
        };
        
        await this.saveProject(project);
      }
      
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(MIGRATED_KEY, 'true');
      
      return true;
    } catch (error) {
      console.error('Migration failed:', error);
      return false;
    }
  },

  async clearAll(): Promise<void> {
    try {
      const db = await getDB();
      const storeNames = ['projects', 'locations', 'images', 'detail-images', 'detail-image-blobs', 'floor-plans', 'floor-plan-images'] as const;
      const tx = db.transaction([...storeNames], 'readwrite');
      await Promise.all(storeNames.map(s => tx.objectStore(s).clear()));
      await tx.done;
      console.log('IndexedDB cleared');
    } catch (e) {
      console.warn('Failed to clear IndexedDB', e);
    }
  },
};

// Format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
