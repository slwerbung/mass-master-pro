import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Project, Location } from '@/types/project';

interface AufmassDBSchema extends DBSchema {
  projects: {
    key: string;
    value: {
      id: string;
      projectNumber: string;
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
}

const DB_NAME = 'aufmass-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<AufmassDBSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<AufmassDBSchema>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<AufmassDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Projects store
      const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
      projectStore.createIndex('by-updated', 'updatedAt');

      // Locations store
      const locationStore = db.createObjectStore('locations', { keyPath: 'id' });
      locationStore.createIndex('by-project', 'projectId');

      // Images store
      const imageStore = db.createObjectStore('images', { keyPath: 'id' });
      imageStore.createIndex('by-location', 'locationId');
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

export const indexedDBStorage = {
  async getProjects(): Promise<Project[]> {
    const db = await getDB();
    const projectRecords = await db.getAll('projects');
    
    const projects: Project[] = [];
    
    for (const record of projectRecords) {
      const locations = await this.getLocationsByProject(record.id);
      projects.push({
        id: record.id,
        projectNumber: record.projectNumber,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        locations,
      });
    }
    
    return projects;
  },

  async getProject(id: string): Promise<Project | null> {
    const db = await getDB();
    const record = await db.get('projects', id);
    
    if (!record) return null;
    
    const locations = await this.getLocationsByProject(id);
    
    return {
      id: record.id,
      projectNumber: record.projectNumber,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      locations,
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
      
      locations.push({
        id: record.id,
        locationNumber: record.locationNumber,
        locationName: record.locationName,
        comment: record.comment,
        imageData,
        originalImageData,
        createdAt: new Date(record.createdAt),
      });
    }
    
    return locations;
  },

  async saveProject(project: Project): Promise<void> {
    const db = await getDB();
    
    // Save project metadata
    await db.put('projects', {
      id: project.id,
      projectNumber: project.projectNumber,
      createdAt: project.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    });
    
    // Get existing locations to check what's new
    const existingLocations = await db.getAllFromIndex('locations', 'by-project', project.id);
    const existingLocationIds = new Set(existingLocations.map(l => l.id));
    
    // Save locations and their images
    for (const location of project.locations) {
      // Save location metadata
      await db.put('locations', {
        id: location.id,
        projectId: project.id,
        locationNumber: location.locationNumber,
        locationName: location.locationName,
        comment: location.comment,
        createdAt: location.createdAt.toISOString(),
      });
      
      // Only save images if they're new or location is new
      if (!existingLocationIds.has(location.id)) {
        // Save annotated image
        if (location.imageData) {
          const annotatedBlob = base64ToBlob(location.imageData);
          await db.put('images', {
            id: createImageId(location.id, 'annotated'),
            locationId: location.id,
            type: 'annotated',
            blob: annotatedBlob,
          });
        }
        
        // Save original image
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
    
    // Remove deleted locations
    const currentLocationIds = new Set(project.locations.map(l => l.id));
    for (const existingLocation of existingLocations) {
      if (!currentLocationIds.has(existingLocation.id)) {
        await db.delete('locations', existingLocation.id);
        await db.delete('images', createImageId(existingLocation.id, 'annotated'));
        await db.delete('images', createImageId(existingLocation.id, 'original'));
      }
    }
  },

  async deleteProject(id: string): Promise<void> {
    const db = await getDB();
    
    // Delete all locations and their images
    const locations = await db.getAllFromIndex('locations', 'by-project', id);
    for (const location of locations) {
      await db.delete('images', createImageId(location.id, 'annotated'));
      await db.delete('images', createImageId(location.id, 'original'));
      await db.delete('locations', location.id);
    }
    
    // Delete project
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
    
    // Check if already migrated
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
      
      // Clear localStorage to free up space
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
