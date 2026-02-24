import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Project, Location, DetailImage, FloorPlan } from '@/types/project';

interface AufmassDBSchema extends DBSchema {
  projects: {
    key: string;
    value: {
      id: string;
      projectNumber: string;
      projectType?: 'aufmass' | 'aufmass_mit_plan';
      createdAt: string;
      updatedAt: string;
    };
    indexes: { 'by-updated': string };
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
const DB_VERSION = 3;

let dbInstance: IDBPDatabase<AufmassDBSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<AufmassDBSchema>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<AufmassDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
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
    },
  });

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

export const indexedDBStorage = {
  async getProjects(): Promise<Project[]> {
    const db = await getDB();
    const projectRecords = await db.getAll('projects');
    
    const projects: Project[] = [];
    
    for (const record of projectRecords) {
      const locations = await this.getLocationsByProject(record.id);
      const floorPlans = await this.getFloorPlansByProject(record.id);
      projects.push({
        id: record.id,
        projectNumber: record.projectNumber,
        projectType: record.projectType,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        locations,
        floorPlans,
      });
    }
    
    return projects;
  },

  async getProject(id: string): Promise<Project | null> {
    const db = await getDB();
    const record = await db.get('projects', id);
    
    if (!record) return null;
    
    const locations = await this.getLocationsByProject(id);
    const floorPlans = await this.getFloorPlansByProject(id);
    
    return {
      id: record.id,
      projectNumber: record.projectNumber,
      projectType: record.projectType,
      createdAt: new Date(record.createdAt),
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
        imageData,
        originalImageData,
        detailImages,
        createdAt: new Date(record.createdAt),
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
        createdAt: new Date(record.createdAt),
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

  async updateLocationMetadata(projectId: string, locationId: string, data: { locationName?: string; comment?: string; system?: string; label?: string; locationType?: string }): Promise<void> {
    const db = await getDB();
    const record = await db.get('locations', locationId);
    if (!record) return;
    
    await db.put('locations', {
      ...record,
      locationName: data.locationName,
      comment: data.comment,
      system: data.system,
      label: data.label,
      locationType: data.locationType,
    });

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
        createdAt: new Date(record.createdAt),
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
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          locations: p.locations.map((l: any) => ({
            id: l.id,
            locationNumber: l.locationNumber,
            locationName: l.locationName,
            comment: l.comment,
            imageData: l.imageData,
            originalImageData: l.originalImageData,
            createdAt: new Date(l.createdAt),
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
};

// Format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
