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
import { CompanyLogo } from "@/components/CompanyLogo";

const SESSION_CACHE_KEY = "session_validation_cache";
function setLoginCache(role: string, token: string, userId: string) {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      key: `${role}:${token}:${userId}`,
      ts: Date.now(),
      valid: true,
    }));
  } catch {}
}

const CustomerLogin = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If already logged in as customer, go straight to customer view
    const session = getSession();
    if (session?.role === "customer") navigate("/customer", { replace: true });
  }, [navigate]);

  const handleLogin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      // Validate server-side and get a signed customer token.
      // UX is unchanged (type name, submit) but the server now issues the token
      // and customer-data / validate-session require it.
      const { data, error } = await supabase.functions.invoke("validate-customer", {
        body: { customerName: name.trim() },
      });

      if (error) {
        toast.error("Verbindungsfehler");
        return;
      }

      if (!data?.valid || !data?.token || !data?.customer) {
        toast.error("Name nicht gefunden. Bitte wenden Sie sich an Ihren Ansprechpartner.");
        return;
      }

      setSession({
        role: "customer",
        id: data.customer.id,
        name: data.customer.name,
        authToken: data.token,
        expiresAt: data.expiresAt,
      });
      setLoginCache("customer", data.token, data.customer.id);
      toast.success(`Willkommen, ${data.customer.name}!`);
      // Small delay to ensure session is written before navigation
      setTimeout(() => navigate("/customer", { replace: true }), 50);
    } catch {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <CompanyLogo wrapperClassName="flex justify-center" className="max-h-20 w-auto" />
        <Card>
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto bg-primary/10 rounded-full p-3 w-fit">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Kunden-Zugang</CardTitle>
            <CardDescription>Geben Sie Ihren Namen ein, um auf Ihr Projekt zuzugreifen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Ihr Name</Label>
              <Input
                id="name"
                placeholder="Name eingeben"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleLogin()}
                autoFocus
                disabled={loading}
              />
            </div>
            <Button className="w-full" onClick={handleLogin} disabled={!name.trim() || loading}>
              {loading ? "Prüfe..." : "Weiter"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CustomerLogin;
