import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSubject: string;
  defaultBody: string;
  // When set, the recipient e-mail is pre-filled from the linked HERO project
  // (same lookup as the correction/approval invite) and the send is logged to
  // that project's HERO logbook.
  projectId?: string;
}

/**
 * Sends a meeting protocol to a customer by e-mail. Mirrors InviteCustomerDialog:
 * the address is prefilled best-effort from HERO (when the protocol belongs to a
 * project); subject and body are a ready template the employee can extend.
 */
export function SendProtocolDialog({ open, onOpenChange, defaultSubject, defaultBody, projectId }: Props) {
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [looking, setLooking] = useState(false);
  const [sending, setSending] = useState(false);

  const token = getSession()?.authToken;

  // Reset the editable template whenever the dialog opens for a note.
  useEffect(() => {
    if (!open) return;
    setSubject(defaultSubject);
    setBody(defaultBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Best-effort prefill of the recipient from HERO (project-bound protocols).
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLooking(true);
    supabase.functions
      .invoke("project-invite", { body: { action: "protocol_lookup_email", token, projectId } })
      .then(({ data }) => { if (!cancelled && data?.email) setEmail((prev) => prev || data.email); })
      .catch(() => { /* manual entry */ })
      .finally(() => { if (!cancelled) setLooking(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const send = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (!body.trim()) { toast.error("Der Protokoll-Text ist leer."); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("project-invite", {
        body: { action: "send_protocol", token, email: trimmed, subject: subject.trim(), bodyText: body, projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Protokoll gesendet an " + trimmed);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Senden fehlgeschlagen: " + (e.message || "Unbekannter Fehler"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Protokoll an Kunden senden</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sp-email">Empfänger</Label>
            <div className="relative">
              <Input
                id="sp-email"
                type="email"
                placeholder="kunde@firma.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              {looking && <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
            </div>
            {projectId && (
              <p className="text-xs text-muted-foreground">
                {looking ? "Adresse wird aus HERO geladen…" : "Aus dem HERO-Projekt vorbefüllt, falls vorhanden – sonst bitte eintragen."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-subject">Betreff</Label>
            <Input id="sp-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-body">Nachricht</Label>
            <Textarea
              id="sp-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="font-mono text-xs leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">Fertige Vorlage – du kannst sie vor dem Senden anpassen.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Abbrechen</Button>
          <Button onClick={send} disabled={sending || !email.trim()}>
            {sending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Senden…</> : <><Send className="h-4 w-4 mr-1" /> Senden</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
