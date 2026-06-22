import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectNumber: string;
  heroProjectId: number | null;
}

/**
 * Lets an employee send a customer an invitation to approve a project online.
 * The email is pre-filled best-effort from the linked HERO project; otherwise
 * it's entered manually. A short, optional personal note can be added. The
 * standard mail text is previewed below.
 */
export function InviteCustomerDialog({ open, onOpenChange, projectId, projectNumber, heroProjectId }: Props) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [looking, setLooking] = useState(false);
  const [sending, setSending] = useState(false);

  const token = getSession()?.authToken;

  // Best-effort prefill from HERO when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setNote("");
    if (!heroProjectId) return;
    let cancelled = false;
    setLooking(true);
    supabase.functions
      .invoke("project-invite", { body: { action: "lookup_email", token, heroProjectId } })
      .then(({ data }) => {
        if (!cancelled && data?.email) setEmail((prev) => prev || data.email);
      })
      .catch(() => { /* manual entry */ })
      .finally(() => { if (!cancelled) setLooking(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, heroProjectId]);

  const send = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("project-invite", {
        body: { action: "send", token, projectId, email: trimmed, note },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Einladung gesendet an " + trimmed);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Senden fehlgeschlagen: " + (e.message || "Unbekannter Fehler"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Kunde einladen</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Einladung senden an</Label>
            <div className="relative">
              <Input
                id="invite-email"
                type="email"
                placeholder="kunde@firma.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              {looking && <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground">
              {looking ? "Adresse wird aus HERO geladen…" : "Aus dem HERO-Projekt vorbefüllt, falls vorhanden – sonst bitte eintragen."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-note">Persönliche Nachricht (optional)</Label>
            <Textarea
              id="invite-note"
              placeholder="z. B. Hallo Herr Müller, hier die Standorte zur Freigabe …"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>

          {/* Mail-Vorschau, klein */}
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Vorschau der E-Mail</p>
            <p><span className="text-foreground">Betreff:</span> Freigabe-Anfrage: Projekt {projectNumber}</p>
            <p>Guten Tag, für Ihr Projekt {projectNumber} haben wir die Standorte und Layouts zur Freigabe vorbereitet. Bitte öffnen Sie den Link, sehen Sie sich die Standorte an und erteilen Sie Ihre Freigabe direkt online – ohne Anmeldung.</p>
            {note.trim() && <p className="italic">„{note.trim()}"</p>}
            <p className="text-foreground">[ Standorte ansehen &amp; freigeben ]</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Abbrechen</Button>
          <Button onClick={send} disabled={sending || !email.trim()}>
            {sending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Senden…</> : <><Mail className="h-4 w-4 mr-1" /> Einladung senden</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
