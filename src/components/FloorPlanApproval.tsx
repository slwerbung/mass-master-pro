import { useState } from "react";
import { ChevronLeft, ChevronRight, MapPin, Check } from "lucide-react";

export interface PlanMarker { id: string; locationId: string; x: number; y: number; }
export interface PlanPage {
  id: string;
  name?: string;
  imageUrl: string;
  markers: PlanMarker[];
}

interface Props {
  pages: PlanPage[];
  locationNumber: (locationId: string) => string;     // marker label
  isApproved: (locationId: string) => boolean;        // colour the pin
  onMarkerClick: (locationId: string) => void;        // open approval for it
}

/**
 * Shows the project's floor plan(s) to the customer with numbered, clickable
 * markers. A marker is green once that location is approved. Clicking a marker
 * opens that location for approval. Multi-page plans are flippable.
 */
export function FloorPlanApproval({ pages, locationNumber, isApproved, onMarkerClick }: Props) {
  const [page, setPage] = useState(0);
  if (!pages || pages.length === 0) return null;
  const p = pages[Math.min(page, pages.length - 1)];
  const go = (d: number) => setPage((page + d + pages.length) % pages.length);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Grundriss{pages.length > 1 ? ` · Seite ${page + 1}/${pages.length}` : ""}</p>
        <p className="text-xs text-muted-foreground">Tippe einen Marker an, um den Standort freizugeben.</p>
      </div>

      <div className="relative w-full bg-muted rounded-lg overflow-hidden">
        <img src={p.imageUrl} alt={p.name || "Grundriss"} className="w-full h-auto max-h-[75vh] object-contain mx-auto block" />

        {/* Marker */}
        {p.markers.map((m) => {
          const approved = isApproved(m.locationId);
          return (
            <button
              key={m.id}
              className="absolute -translate-x-1/2 -translate-y-full group"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              onClick={() => onMarkerClick(m.locationId)}
              title={`Standort ${locationNumber(m.locationId)}${approved ? " (freigegeben)" : ""}`}
            >
              <div className="flex flex-col items-center">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm mb-0.5 whitespace-nowrap shadow-md flex items-center gap-0.5 ${approved ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"}`}>
                  {approved && <Check className="h-2.5 w-2.5" />}
                  {locationNumber(m.locationId)}
                </span>
                <MapPin className={`h-7 w-7 drop-shadow-md transition-transform group-hover:scale-110 ${approved ? "text-green-600" : "text-primary"}`} fill="currentColor" />
              </div>
            </button>
          );
        })}

        {/* Page nav */}
        {pages.length > 1 && (
          <>
            <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/90 hover:bg-background rounded-full p-1.5 shadow-md">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/90 hover:bg-background rounded-full p-1.5 shadow-md">
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
