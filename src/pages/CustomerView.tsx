import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogOut, Save, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { getSession, clearSession } from "@/lib/session";

interface Assignment {
  id: string;
  project_id: string;
  projects: { id: string; project_number: string };
}

const CustomerView = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [guestInfoMap, setGuestInfoMap] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // We need admin password to call admin-manage. For customer actions, 
  // we'll use a dedicated edge function or pass through differently.
  // Actually, customer data actions don't need admin password - let's adjust.
  // For simplicity, customer endpoints accept customerId as auth.

  useEffect(() => {
    if (!session || session.role !== "customer") {
      navigate("/");
      return;
    }
    loadAssignments();
  }, []);

  const loadAssignments = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("customer-data", {
        body: { action: "get_projects", customerId: session!.id },
      });
      if (error || data?.error) {
        toast.error("Fehler beim Laden");
        return;
      }
      setAssignments(data.assignments || []);
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-data", {
        body: {
          action: "get_locations",
          customerId: session!.id,
          assignmentId: assignment.id,
        },
      });
      if (error || data?.error) {
        toast.error("Fehler beim Laden");
        return;
      }
      setLocations(data.locations || []);
      setPermissions(data.permissions || []);
      setImages(data.images || []);
      const infoMap: Record<string, string> = {};
      (data.locations || []).forEach((l: any) => {
        infoMap[l.id] = l.guest_info || "";
      });
      setGuestInfoMap(infoMap);
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  const canEdit = (locationId: string) => {
    return permissions.some(
      (p: any) => p.location_id === locationId && p.can_edit_guest_info
    );
  };

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    return data.publicUrl;
  };

  const saveGuestInfo = async (locationId: string) => {
    if (!selectedAssignment) return;
    setSavingId(locationId);
    try {
      const { data, error } = await supabase.functions.invoke("customer-data", {
        body: {
          action: "update_guest_info",
          customerId: session!.id,
          assignmentId: selectedAssignment.id,
          locationId,
          guestInfo: guestInfoMap[locationId] || null,
        },
      });
      if (error || data?.error) {
        toast.error("Fehler beim Speichern");
      } else {
        toast.success("Gespeichert");
      }
    } catch {
      toast.error("Fehler beim Speichern");
    }
    setSavingId(null);
  };

  const handleLogout = () => {
    clearSession();
    navigate("/");
  };

  if (loading && !selectedAssignment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedAssignment && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedAssignment(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-xl font-bold">
                {selectedAssignment
                  ? `Projekt ${selectedAssignment.projects.project_number}`
                  : "Meine Projekte"}
              </h1>
              <p className="text-sm text-muted-foreground">{session?.name}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        {!selectedAssignment ? (
          // Project list
          assignments.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              Keine Projekte zugewiesen.
            </p>
          ) : (
            <div className="grid gap-3">
              {assignments.map((a) => (
                <Card
                  key={a.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => loadLocations(a)}
                >
                  <CardHeader>
                    <CardTitle>Projekt {a.projects.project_number}</CardTitle>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )
        ) : (
          // Location list
          loading ? (
            <p className="text-center text-muted-foreground py-8">Laden...</p>
          ) : locations.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              Keine Standorte vorhanden.
            </p>
          ) : (
            <div className="space-y-4">
              {locations.map((loc) => {
                const annotated = images.find(
                  (i: any) => i.location_id === loc.id && i.image_type === "annotated"
                );
                return (
                  <Card key={loc.id}>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-lg">
                        Standort {loc.location_number}
                        {loc.location_name && (
                          <span className="font-normal text-muted-foreground ml-2">
                            · {loc.location_name}
                          </span>
                        )}
                      </CardTitle>
                      {loc.comment && (
                        <p className="text-sm text-muted-foreground">{loc.comment}</p>
                      )}
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      {annotated && (
                        <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                          <img
                            src={getImageUrl(annotated.storage_path)}
                            alt={`Standort ${loc.location_number}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      )}
                      {canEdit(loc.id) && (
                        <div className="space-y-2">
                          <Label>Informationen</Label>
                          <Textarea
                            placeholder="Informationen zu diesem Standort ergänzen..."
                            value={guestInfoMap[loc.id] || ""}
                            onChange={(e) =>
                              setGuestInfoMap((prev) => ({
                                ...prev,
                                [loc.id]: e.target.value,
                              }))
                            }
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
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default CustomerView;
