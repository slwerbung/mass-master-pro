import { useState, useEffect } from "react";
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
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"password" | "name">("password");

  useEffect(() => {
    const checkProject = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, guest_password")
        .eq("id", projectId!)
        .single();

      if (error || !data) {
        toast.error("Projekt nicht gefunden");
        navigate("/");
        return;
      }

      const hasPassword = !!data.guest_password;
      setNeedsPassword(hasPassword);
      setStep(hasPassword ? "password" : "name");
      setLoading(false);
    };
    checkProject();
  }, [projectId, navigate]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await supabase
      .from("projects")
      .select("guest_password")
      .eq("id", projectId!)
      .single();

    if (data?.guest_password === password) {
      setStep("name");
    } else {
      toast.error("Falsches Passwort");
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) return;
    localStorage.setItem("guest_name", guestName.trim());
    navigate(`/guest/${projectId}/view`);
  };

  if (loading || needsPassword === null) return null;

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
              <Button type="submit" className="w-full">Weiter</Button>
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
