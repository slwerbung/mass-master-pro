import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { setSession } from "@/lib/session";

const GuestAccess = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState(() => localStorage.getItem("guest_name") || "");
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

  useEffect(() => {
    checkAndValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    checkAndValidate(password);
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !projectId) return;
    setLoading(true);
    try {
      const trimmedName = guestName.trim();

      const { data, error } = await supabase.functions.invoke("ensure-customer-assignment", {
        body: { projectId, customerName: trimmedName },
      });

      if (error || !data?.success || !data?.token || !data?.customer?.id) {
        toast.error("Anmeldung fehlgeschlagen");
        return;
      }

      const customerId = data.customer.id;
      const customerName = data.customer.name || trimmedName;

      // Store the customer name for next visit so we can prefill it.
      localStorage.setItem("guest_name", customerName);

      // Set up a full customer session - same shape as the regular
      // /kunde login. From here on the app treats this user like any
      // other logged-in customer; no more "limited guest" mode.
      setSession({
        role: "customer",
        id: customerId,
        name: customerName,
        authToken: data.token,
        expiresAt: data.expiresAt,
      });

      navigate(`/customer?project=${projectId}`, { replace: true });
    } catch {
      toast.error("Fehler beim Anmelden");
    } finally {
      setLoading(false);
    }
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
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Lädt..." : "Projekt ansehen"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GuestAccess;
