import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { toast } from "sonner";

const GuestAccess = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState(() => localStorage.getItem("guest_name") || "");
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"check" | "password" | "name">("check");

  // Check if project needs password on first interaction
  const checkAndValidate = async (pw?: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-guest", {
        body: { projectId, password: pw || "" },
      });

      if (error) {
        toast.error("Projekt nicht gefunden");
        navigate("/");
        return;
      }

      if (data.valid) {
        localStorage.setItem("guest_token", data.token);
        localStorage.setItem("guest_project_number", data.projectNumber);
        setStep("name");
      } else if (data.needsPassword) {
        setNeedsPassword(true);
        setStep("password");
        if (pw) toast.error("Falsches Passwort");
      } else {
        toast.error("Projekt nicht gefunden");
        navigate("/");
      }
    } catch {
      toast.error("Fehler beim Verbinden");
    } finally {
      setLoading(false);
    }
  };

  // On mount, try without password first
  useState(() => {
    checkAndValidate();
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    checkAndValidate(password);
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) return;
    localStorage.setItem("guest_name", guestName.trim());
    navigate(`/guest/${projectId}/view`);
  };

  if (step === "check") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Gastzugang</CardTitle>
          <CardDescription>Projekt ansehen und Informationen ergänzen</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "password" ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guest-pw">Passwort</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="guest-pw"
                    type="password"
                    className="pl-9"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Projekt-Passwort eingeben"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Prüfe..." : "Weiter"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleNameSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guest-name">Ihr Name</Label>
                <Input
                  id="guest-name"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder="Name eingeben"
                  required
                />
              </div>
              <Button type="submit" className="w-full">Projekt ansehen</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GuestAccess;
