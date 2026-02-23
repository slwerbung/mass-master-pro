import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ArrowLeft, FileText, Save } from "lucide-react";
import { toast } from "sonner";

interface LocationData {
  id: string;
  location_number: string;
  location_name: string | null;
  comment: string | null;
  system: string | null;
  label: string | null;
  location_type: string | null;
  guest_info: string | null;
}

interface ImageData {
  location_id: string;
  image_type: string;
  storage_path: string;
}

interface PdfData {
  id: string;
  location_id: string;
  storage_path: string;
  file_name: string;
}

const GuestProject = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projectNumber, setProjectNumber] = useState("");
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [images, setImages] = useState<ImageData[]>([]);
  const [pdfs, setPdfs] = useState<PdfData[]>([]);
  const [guestInfoMap, setGuestInfoMap] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const guestName = localStorage.getItem("guest_name") || "Gast";

  useEffect(() => {
    const load = async () => {
      const { data: project } = await supabase
        .from("projects")
        .select("project_number")
        .eq("id", projectId!)
        .single();

      if (!project) { navigate("/"); return; }
      setProjectNumber(project.project_number);

      const { data: locs } = await supabase
        .from("locations")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at");

      if (locs) {
        setLocations(locs as LocationData[]);
        const infoMap: Record<string, string> = {};
        locs.forEach((l: any) => { infoMap[l.id] = l.guest_info || ""; });
        setGuestInfoMap(infoMap);

        const locationIds = locs.map((l: any) => l.id);
        
        if (locationIds.length > 0) {
          const { data: imgs } = await supabase
            .from("location_images")
            .select("location_id, image_type, storage_path")
            .in("location_id", locationIds);
          if (imgs) setImages(imgs as ImageData[]);

          const { data: pdfData } = await supabase
            .from("location_pdfs")
            .select("*")
            .in("location_id", locationIds);
          if (pdfData) setPdfs(pdfData as PdfData[]);
        }
      }
    };
    load();
  }, [projectId, navigate]);

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    return data.publicUrl;
  };

  const saveGuestInfo = async (locationId: string) => {
    setSavingId(locationId);
    const { error } = await supabase
      .from("locations")
      .update({ guest_info: guestInfoMap[locationId] || null })
      .eq("id", locationId);

    if (error) {
      toast.error("Fehler beim Speichern");
    } else {
      toast.success("Gespeichert");
    }
    setSavingId(null);
  };

  const annotatedImage = (locationId: string) => {
    const img = images.find(i => i.location_id === locationId && i.image_type === "annotated");
    return img ? getImageUrl(img.storage_path) : null;
  };

  const locationPdfs = (locationId: string) => pdfs.filter(p => p.location_id === locationId);

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Zurück
          </Button>
          <div>
            <h1 className="text-xl font-bold">Projekt {projectNumber}</h1>
            <p className="text-sm text-muted-foreground">Gastzugang · {guestName}</p>
          </div>
        </div>

        {locations.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">Noch keine Standorte vorhanden.</p>
        ) : (
          <div className="space-y-6">
            {locations.map(loc => (
              <Card key={loc.id}>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-lg">
                    Standort {loc.location_number}
                    {loc.location_name && <span className="font-normal text-muted-foreground ml-2">· {loc.location_name}</span>}
                  </CardTitle>
                  {(loc.system || loc.label || loc.location_type) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {loc.system && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{loc.system}</span>}
                      {loc.location_type && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{loc.location_type}</span>}
                      {loc.label && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{loc.label}</span>}
                    </div>
                  )}
                  {loc.comment && <p className="text-sm text-muted-foreground mt-1">{loc.comment}</p>}
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {annotatedImage(loc.id) && (
                    <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                      <img src={annotatedImage(loc.id)!} alt={`Standort ${loc.location_number}`} className="w-full h-full object-contain" />
                    </div>
                  )}

                  {/* PDFs */}
                  {locationPdfs(loc.id).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Druckdaten</p>
                      {locationPdfs(loc.id).map(pdf => (
                        <a
                          key={pdf.id}
                          href={getImageUrl(pdf.storage_path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                          <FileText className="h-4 w-4" />
                          {pdf.file_name}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Guest info field */}
                  <div className="space-y-2">
                    <Label>Informationen (von Ihnen)</Label>
                    <Textarea
                      placeholder="Informationen zu diesem Standort ergänzen..."
                      value={guestInfoMap[loc.id] || ""}
                      onChange={e => setGuestInfoMap(prev => ({ ...prev, [loc.id]: e.target.value }))}
                      rows={3}
                    />
                    <Button
                      size="sm"
                      onClick={() => saveGuestInfo(loc.id)}
                      disabled={savingId === loc.id}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {savingId === loc.id ? "Speichert..." : "Speichern"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GuestProject;
