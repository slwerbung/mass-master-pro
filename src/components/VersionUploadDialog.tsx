// Spec D1: Rueckfrage vor dem Hochladen einer neuen Version (Druckdatei / Fahrzeuglayout).
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

export interface VersionUploadChoice {
  note: string;
  resetApproval: boolean;
  resolveOpen: boolean;
  /** gesetzt = Kunde per Mail benachrichtigen */
  notifyEmail: string | null;
}

export function VersionUploadDialog({ open, onOpenChange, title, subtitle, projectId, onConfirm }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** z. B. „Neue Version v3 hochladen“ */
  title: string;
  subtitle?: string;
  projectId: string;
  onConfirm: (choice: VersionUploadChoice) => Promise<void> | void;
}) {
  const [note, setNote] = useState("");
  const [reset, setReset] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [notify, setNotify] = useState(false);
  const [email, setEmail] = useState("");
  const [lookedUp, setLookedUp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNote(""); setReset(true); setResolveOpen(false); setNotify(false); setBusy(false);
  }, [open]);

  // E-Mail des HERO-Ansprechpartners vorbefuellen (einmal, wenn „benachrichtigen“ angehakt wird).
  useEffect(() => {
    if (!notify || lookedUp || email) return;
    setLookedUp(true);
    supabase.functions.invoke("project-invite", { body: { action: "protocol_lookup_email", token: getSession()?.authToken, projectId } })
      .then(({ data }) => { if (data?.email) setEmail((e) => e || String(data.email)); })
      .catch(() => null);
  }, [notify, lookedUp, email, projectId]);

  const emailOk = !notify || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm({ note: note.trim(), resetApproval: reset, resolveOpen, notifyEmail: notify ? email.trim() : null });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="version-note">Was wurde geändert? <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="version-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Logo größer, Farbe angepasst" />
            <p className="text-right text-[11px] text-muted-foreground">{note.length}/300</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={reset} onCheckedChange={(v) => setReset(v === true)} className="mt-0.5" />
            <span>Freigabe des Kunden zurücksetzen<br /><span className="text-xs text-muted-foreground">Der Kunde muss die neue Version erneut freigeben.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={resolveOpen} onCheckedChange={(v) => setResolveOpen(v === true)} className="mt-0.5" />
            <span>Offene Korrekturen der Vorversion als umgesetzt markieren</span>
          </label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} className="mt-0.5" />
              <span>Kunde per Mail benachrichtigen</span>
            </label>
            {notify && (
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kunde@beispiel.de" autoComplete="off" />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button disabled={busy || !emailOk} onClick={confirm}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Hochladen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
