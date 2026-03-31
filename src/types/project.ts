export interface Measurement {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: string; // in mm
}

export interface AreaMeasurement {
  index: number;
  widthMm: number;
  heightMm: number;
}

export interface DetailImage {
  id: string;
  imageData: string;      // bearbeitetes Bild
  originalImageData: string; // Originalbild
  caption?: string;       // optionale Beschreibung
  createdAt: Date;
}

export interface LocationFeedback {
  id: string;
  locationId: string;
  message: string;
  authorName: string;
  authorCustomerId?: string;
  status: 'open' | 'done';
  createdAt: Date;
  resolvedAt?: Date;
}

export interface Location {
  id: string;
  locationNumber: string; // Projektnummer + fortlaufende Nummer
  locationName?: string; // optional Standortbezeichnung
  comment?: string; // optional Kommentar
  imageData: string; // base64 encoded image with annotations
  originalImageData: string; // original photo
  detailImages?: DetailImage[];
  system?: string;        // z.B. "Türschilder"
  label?: string;         // Beschriftung
  locationType?: string;  // Art, z.B. "Raum", "Flur", "Eingang"
  customFields?: Record<string, string>;
  guestInfo?: string;
  feedbacks?: LocationFeedback[];
  areaMeasurements?: AreaMeasurement[];
  createdAt: Date;
}

export interface FloorPlanMarker {
  id: string;
  locationId: string;  // Verknüpfung zum Standort
  x: number;           // Position auf dem Grundriss (0-1, relativ)
  y: number;
}

export interface FloorPlan {
  id: string;
  name: string;        // z.B. "EG", "1. OG"
  imageData: string;   // Gerenderte PDF-Seite als Bild
  markers: FloorPlanMarker[];
  pageIndex: number;   // Welche Seite der PDF
  createdAt: Date;
}

export interface Project {
  id: string;
  projectNumber: string;
  customerName?: string;
  customFields?: Record<string, string | boolean>;
  projectType?: 'aufmass' | 'aufmass_mit_plan';
  employeeId?: string | null;
  accessEmployeeIds?: string[];
  floorPlans?: FloorPlan[];
  locations: Location[];
  createdAt: Date;
  updatedAt: Date;
}
