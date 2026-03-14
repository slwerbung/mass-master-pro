import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { setSession, getSession } from "@/lib/session";

const CustomerLogin = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (session?.role === "customer") navigate("/customer");
  }, [navigate]);

  const handleLogin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .ilike("name", name.trim())
        .single();

      if (error || !data) {
        toast.error("Name nicht gefunden. Bitte wenden Sie sich an Ihren Ansprechpartner.");
      } else {
        setSession({ role: "customer", id: data.id, name: data.name });
        toast.success(`Willkommen, ${data.name}!`);
        navigate("/customer");
      }
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto bg-primary/10 rounded-full p-3 w-fit">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Kunden-Zugang</CardTitle>
          <CardDescription>
            Geben Sie Ihren Namen ein, um auf Ihr Projekt zuzugreifen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Ihr Name</Label>
            <Input
              id="name"
              placeholder="Name eingeben"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              autoFocus
            />
          </div>
          <Button
            className="w-full"
            onClick={handleLogin}
            disabled={!name.trim() || loading}
          >
            {loading ? "Prüfe..." : "Weiter"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default CustomerLogin;
