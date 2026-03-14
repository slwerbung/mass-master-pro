import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LogOut, Save, ArrowLeft, CheckCheck, FileText } from "lucide-react";
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
  // Approvals: locationId -> approved boolean
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [savingApprovals, setSavingApprovals] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "customer") { navigate("/"); return; }
    loadAssignments();
  }, []);

  const loadAssignments = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("customer-data", {
        body: { action: "get_projects", customerId: session!.id },
      });
      if (error || data?.error) { toast.error("Fehler beim Laden"); return; }
      setAssignments(data.assignments || []);
    } catch { toast.error("Verbindungsfehler"); }
    finally { setLoading(false); }
  };

  const loadLocations = async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-data", {
        body: { action: "get_locations", customerId: session!.id, assignmentId: assignment.id },
      });
      if (error || data?.error) { toast.error("Fehler beim Laden"); return; }
      setLocations(data.locations || []);
      setPermissions(data.permissions || []);
      setImages(data.images || []);
      const infoMap: Record<string, string> = {};
      (data.locations || []).forEach((l: any) => { infoMap[l.id] = l.guest_info || ""; });
      setGuestInfoMap(infoMap);

      // Load approvals for this assignment
      const locationIds = (data.locations || []).map((l: any) => l.id);
      if (locationIds.length > 0) {
        const { data: approvData } = await supabase
          .from("location_approvals")
          .select("location_id, approved")
          .eq("assignment_id", assignment.id)
          .in("location_id", locationIds);
        const approvMap: Record<string, boolean> = {};
        (approvData || []).forEach((a: any) => { approvMap[a.location_id] = a.approved; });
        setApprovals(approvMap);
      }
    } catch { toast.error("Verbindungsfehler"); }
    finally { setLoading(false); }
  };

  const canEdit = (locationId: string) => permissions.some((p: any) => p.location_id === locationId && p.can_edit_guest_info);

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    return data.publicUrl;
  };

  const saveGuestInfo = async (locationId: string) => {
    if (!selectedAssignment) return;
    setSavingId(locationId);
    try {
      const { data, error } = await supabase.functions.invoke("customer-data", {
        body: { action: "update_guest_info", customerId: session!.id, assignmentId: selectedAssignment.id, locationId, guestInfo: guestInfoMap[locationId] || null },
      });
      if (error || data?.error) toast.error("Fehler beim Speichern");
      else toast.success("Gespeichert");
    } catch { toast.error("Fehler beim Speichern"); }
    setSavingId(null);
  };

  const toggleApproval = async (locationId: string, approved: boolean) => {
    if (!selectedAssignment) return;
    setApprovals(prev => ({ ...prev, [locationId]: approved }));
    await supabase.from("location_approvals").upsert({
      location_id: locationId,
      assignment_id: selectedAssignment.id,
      approved,
      approved_at: approved ? new Date().toISOString() : null,
    }, { onConflict: "location_id,assignment_id" });
  };

  const approveAll = async (approved: boolean) => {
    if (!selectedAssignment) return;
    setSavingApprovals(true);
    const newApprovals: Record<string, boolean> = {};
    locations.forEach(l => { newApprovals[l.id] = approved; });
    setApprovals(newApprovals);
    const rows = locations.map(l => ({
      location_id: l.id, assignment_id: selectedAssignment.id,
      approved, approved_at: approved ? new Date().toISOString() : null,
    }));
    await supabase.from("location_approvals").upsert(rows, { onConflict: "location_id,assignment_id" });
    toast.success(approved ? "Alle Standorte freigegeben" : "Alle Freigaben zurückgenommen");
    setSavingApprovals(false);
  };

  const allApproved = locations.length > 0 && locations.every(l => approvals[l.id]);
  const someApproved = locations.some(l => approvals[l.id]);

  const handleLogout = () => { clearSession(); navigate("/"); };

  if (loading && !selectedAssignment) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Laden...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedAssignment && (
              <Button variant="ghost" size="sm" onClick={() => { setSelectedAssignment(null); setLocations([]); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-xl font-bold">{selectedAssignment ? `Projekt ${selectedAssignment.projects.project_number}` : "Meine Projekte"}</h1>
              <p className="text-sm text-muted-foreground">{session?.name}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}><LogOut className="h-4 w-4" /></Button>
        </div>

        {!selectedAssignment ? (
          assignments.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">Keine Projekte zugewiesen.</p>
          ) : (
            <div className="grid gap-3">
              {assignments.map((a) => (
                <Card key={a.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadLocations(a)}>
                  <CardHeader><CardTitle>Projekt {a.projects.project_number}</CardTitle></CardHeader>
                </Card>
              ))}
            </div>
          )
        ) : loading ? (
          <p className="text-center text-muted-foreground py-8">Laden...</p>
        ) : locations.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">Keine Standorte vorhanden.</p>
        ) : (
          <>
            {/* Alle freigeben Banner */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">Gesamtfreigabe</p>
                    <p className="text-xs text-muted-foreground">
                      {locations.filter(l => approvals[l.id]).length} von {locations.length} Standorten freigegeben
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {someApproved && (
                      <Button size="sm" variant="outline" onClick={() => approveAll(false)} disabled={savingApprovals}>
                        Alle zurücknehmen
                      </Button>
                    )}
                    <Button size="sm" onClick={() => approveAll(true)} disabled={allApproved || savingApprovals}>
                      <CheckCheck className="h-4 w-4 mr-1" /> Alle freigeben
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {locations.map((loc) => {
                const annotated = images.find((i: any) => i.location_id === loc.id && i.image_type === "annotated");
                const pdfEntry = images.find((i: any) => i.location_id === loc.id && i.image_type === "pdf");
                const isApproved = !!approvals[loc.id];
                return (
                  <Card key={loc.id} className={isApproved ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : ""}>
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">
                            Standort {loc.location_number}
                            {loc.location_name && <span className="font-normal text-muted-foreground ml-2">· {loc.location_name}</span>}
                          </CardTitle>
                          {loc.comment && <p className="text-sm text-muted-foreground mt-1">{loc.comment}</p>}
                        </div>
                        {/* Freigabe-Checkbox */}
                        <div className="flex items-center gap-2 shrink-0">
                          <Checkbox
                            id={`approve-${loc.id}`}
                            checked={isApproved}
                            onCheckedChange={(checked) => toggleApproval(loc.id, !!checked)}
                            className={isApproved ? "border-green-500 data-[state=checked]:bg-green-500" : ""}
                          />
                          <Label htmlFor={`approve-${loc.id}`} className={`text-sm cursor-pointer ${isApproved ? "text-green-600 font-medium" : "text-muted-foreground"}`}>
                            {isApproved ? "Freigegeben ✓" : "Freigeben"}
                          </Label>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      {annotated && (
                        <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                          <img src={getImageUrl(annotated.storage_path)} alt={`Standort ${loc.location_number}`} className="w-full h-full object-contain" />
                        </div>
                      )}
                      {/* Druckdatei */}
                      {pdfEntry && (() => {
                        const { data: urlData } = supabase.storage.from("project-files").getPublicUrl(pdfEntry.storage_path);
                        return (
                          <a href={urlData.publicUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 hover:bg-muted transition-colors text-sm no-underline">
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <span className="flex-1 font-medium text-foreground">Druckdatei ansehen</span>
                            <span className="text-muted-foreground text-xs">PDF öffnen →</span>
                          </a>
                        );
                      })()}
                      {canEdit(loc.id) && (
                        <div className="space-y-2">
                          <Label>Informationen</Label>
                          <Textarea
                            placeholder="Informationen zu diesem Standort ergänzen..."
                            value={guestInfoMap[loc.id] || ""}
                            onChange={(e) => setGuestInfoMap(prev => ({ ...prev, [loc.id]: e.target.value }))}
                            rows={3}
                          />
                          <Button size="sm" onClick={() => saveGuestInfo(loc.id)} disabled={savingId === loc.id}>
                            <Save className="h-4 w-4 mr-1" />{savingId === loc.id ? "Speichert..." : "Speichern"}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CustomerView;
