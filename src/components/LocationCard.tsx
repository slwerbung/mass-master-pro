import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Pencil, ImagePlus, Camera } from "lucide-react";
import { Location } from "@/types/project";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LocationCardProps {
  location: Location;
  projectId: string;
  onDelete: (locationId: string) => void;
  onDeleteDetailImage: (locationId: string, detailImageId: string) => void;
}

const LocationCard = ({ location, projectId, onDelete, onDeleteDetailImage }: LocationCardProps) => {
  const navigate = useNavigate();

  return (
    <Card className="overflow-hidden">
      <div
        className="aspect-video bg-muted relative cursor-pointer group"
        onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/edit-image`)}
      >
        <img
          src={location.imageData}
          alt={`Standort ${location.locationNumber}`}
          className="w-full h-full object-contain"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Pencil className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <h3 className="font-semibold text-base md:text-lg">Standort {location.locationNumber}</h3>
            {location.locationName && (
              <p className="text-sm text-foreground truncate">{location.locationName}</p>
            )}
            {(location.system || location.label || location.locationType) && (
              <div className="flex flex-wrap gap-1">
                {location.system && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{location.system}</span>
                )}
                {location.locationType && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{location.locationType}</span>
                )}
                {location.label && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{location.label}</span>
                )}
              </div>
            )}
            {location.comment && (
              <p className="text-sm text-muted-foreground line-clamp-2">{location.comment}</p>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/edit`)}
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Standort löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Diese Aktion kann nicht rückgängig gemacht werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(location.id)}
                    className="bg-destructive"
                  >
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Detail Images */}
        {location.detailImages && location.detailImages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detailbilder</p>
            <div className="grid grid-cols-3 gap-2">
              {location.detailImages.map((detail) => (
                <div key={detail.id} className="relative group aspect-square bg-muted rounded overflow-hidden">
                  <img
                    src={detail.imageData}
                    alt={detail.caption || "Detailbild"}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => navigate(`/projects/${projectId}/locations/${location.id}/details/${detail.id}/edit-image`)}
                  />
                  {detail.caption && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">
                      {detail.caption}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 h-6 w-6 p-0 bg-muted/80 hover:bg-muted text-foreground rounded-none rounded-br"
                    onClick={(e) => { e.stopPropagation(); navigate(`/projects/${projectId}/locations/${location.id}/details/${detail.id}/edit`); }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 h-6 w-6 p-0 bg-destructive/80 hover:bg-destructive text-white rounded-none rounded-bl"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Detailbild löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Diese Aktion kann nicht rückgängig gemacht werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onDeleteDetailImage(location.id, detail.id)}
                          className="bg-destructive"
                        >
                          Löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add detail image button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => navigate(`/projects/${projectId}/camera?detail=true&locationId=${location.id}`)}
        >
          <ImagePlus className="h-4 w-4 mr-2" />
          Detailbild hinzufügen
        </Button>
      </CardContent>
    </Card>
  );
};

export default LocationCard;
