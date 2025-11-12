export interface Measurement {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: string; // in mm
}

export interface Location {
  id: string;
  locationNumber: string; // Projektnummer + fortlaufende Nummer
  locationName?: string; // optional Standortbezeichnung
  comment?: string; // optional Kommentar
  imageData: string; // base64 encoded image with annotations
  originalImageData: string; // original photo
  createdAt: Date;
}

export interface Project {
  id: string;
  projectNumber: string;
  locations: Location[];
  createdAt: Date;
  updatedAt: Date;
}
