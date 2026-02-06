export interface Measurement {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: string; // in mm
}

export interface DetailImage {
  id: string;
  imageData: string;      // bearbeitetes Bild
  originalImageData: string; // Originalbild
  caption?: string;       // optionale Beschreibung
  createdAt: Date;
}

export interface Location {
  id: string;
  locationNumber: string; // Projektnummer + fortlaufende Nummer
  locationName?: string; // optional Standortbezeichnung
  comment?: string; // optional Kommentar
  imageData: string; // base64 encoded image with annotations
  originalImageData: string; // original photo
  detailImages?: DetailImage[];
  createdAt: Date;
}

export interface Project {
  id: string;
  projectNumber: string;
  locations: Location[];
  createdAt: Date;
  updatedAt: Date;
}
