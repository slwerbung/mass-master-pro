import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Mail, MessageSquareText, SlidersHorizontal, X } from "lucide-react";
import { invokeFn } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Spinner } from "@/components/ui";
import { MailBody } from "@/components/MailBody";
import { CategoryChip } from "@/components/CategoryChip";
import { TeachBox } from "@/components/TeachBox";
import { cn, errorText, formatDateTime, pct } from "@/lib/utils";

// Gemeinsame Bausteine der Vorschlagskarten („Zu entscheiden").

const TYPE_LABEL: Record<string, string> = {
  create_project: "Kontakt + Projekt anlegen", link_project: "Projekt zuordnen", log_entry: "Ins Logbuch schreiben",
  change_step: "Statuswechsel", upload_attachments: "Anhänge ans Projekt", prepare_offer: "Angebot vorbereiten",
  create_confirmation: "Bestellung → Auftragsbestätigung", send_document: "Prüfen & versenden",
};

export function useDecide(s: Suggestion, successText?: (r: Record<string, any>) => string) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ["suggestions"] }); qc.invalidateQueries({ queryKey: ["overview"] }); qc.invalidateQueries({ queryKey: ["messages"] }); };
  const decide = useMutation({
    mutationFn: ({ decision, edits }: { decision: "accept" | "reject"; edits?: Record<string, unknown> }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invokeFn<{ warnings?: string[]; projectNr?: string } & Record<string, any>>("email-action", { action: "decide", suggestionId: s.id, decision, edits }),
    onSuccess: (r, v) => {
      if (v.decision === "reject") toast("Verworfen – in HERO und im Postfach hat sich nichts geändert.");
      else toast.success(successText?.(r) ?? (r.projectNr ? `Angelegt: ${r.projectNr}` : "Erledigt"));
      r.warnings?.forEach((w) => toast.warning(w));
      done();
    },
    onError: (e) => { toast.error(errorText(e)); done(); },
  });
  return decide;
}

export function Header({ s }: { s: Suggestion }) {
  const m = s.message;
  return (
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{TYPE_LABEL[s.type] ?? s.type}</Badge>
        <CategoryChip category={m.category} />
        {m.confidence != null && <span className="text-xs text-muted-foreground">Konfidenz {pct(m.confidence)}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.sent_at)}</span>
      </div>
      <CardTitle className="pt-1"><Link className="hover:underline" to={`/mails/${m.id}`}>{m.subject || "(ohne Betreff)"}</Link></CardTitle>
      <p className="text-xs text-muted-foreground">{m.direction === "out" ? "an" : "von"} {m.from_name || m.from_addr}</p>
      {m.summary && <p className="text-sm">{m.summary}</p>}
    </CardHeader>
  );
}

function Toggle({ open, onClick, icon, label, hint }: { open: boolean; onClick: () => void; icon: ReactNode; label: string; hint?: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-expanded={open}
      className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-accent", open && "bg-accent")}
    >
      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      {icon}
      <span className="shrink-0">{label}</span>
      {hint != null && hint !== "" && <span className="min-w-0 truncate text-muted-foreground">· {hint}</span>}
    </button>
  );
}

/**
 * Rahmen jeder Vorschlagskarte: sichtbar sind nur Kopf (mit Kurzfassung der Mail) und die Knöpfe.
 * Die Mail selbst und die Felder des Vorschlags klappen bei Bedarf auf.
 */
export function SuggestionCard({ s, brief, actions, children }: { s: Suggestion; brief?: ReactNode; actions: ReactNode; children: ReactNode }) {
  const [details, setDetails] = useState(false);
  const [mail, setMail] = useState(false);
  return (
    <Card>
      <Header s={s} />
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Toggle open={mail} onClick={() => setMail(!mail)} icon={<Mail className="h-3.5 w-3.5" />} label="Mail" />
          <Toggle open={details} onClick={() => setDetails(!details)} icon={<SlidersHorizontal className="h-3.5 w-3.5" />} label="Vorschlag" hint={brief} />
        </div>
        {mail && <div className="rounded-md border p-2"><MailBody messageId={s.message.id} fallbackText={null} /></div>}
        {details && <div className="space-y-3 rounded-md border bg-muted/20 p-3">{children}</div>}
        {actions}
      </CardContent>
    </Card>
  );
}

/** „Titel“ in Anführungszeichen, gekürzt – für Knopf-Beschriftungen. */
export const quoted = (t: string | null | undefined, max = 45) => {
  const x = String(t ?? "").trim();
  return `„${x.length > max ? `${x.slice(0, max - 1)}…` : x}“`;
};

const SKIP_REASONS = ["Schon erledigt", "Brauchen wir nicht", "Mache ich selbst in HERO"];

/**
 * Annehmen – oder sagen, was stattdessen richtig ist. Ein nacktes „Ablehnen" gibt es nicht mehr:
 * „Nein, anders" erklärt dem Assistenten die Lage (Mail läuft neu, neuer Vorschlag),
 * „Nicht nötig" verwirft den Vorschlag ohne Folgen, mit Grund.
 */
export function Buttons({ s, onAccept, onReject, acceptLabel, busy, disabled }: {
  s: Suggestion; onAccept: () => void; onReject: (reason: string) => void; acceptLabel: string; busy: boolean; disabled?: boolean;
}) {
  const [panel, setPanel] = useState<null | "teach" | "skip">(null);
  const [reason, setReason] = useState("");
  const toggle = (p: "teach" | "skip") => setPanel(panel === p ? null : p);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAccept} disabled={busy || disabled} className="h-auto min-h-9 whitespace-normal py-2 text-left">{busy ? <Spinner /> : null} {acceptLabel}</Button>
        <Button variant="outline" onClick={() => toggle("teach")} disabled={busy} className={panel === "teach" ? "bg-accent" : ""}>
          <MessageSquareText className="h-4 w-4" /> Nein, anders …
        </Button>
        <Button variant="ghost" onClick={() => toggle("skip")} disabled={busy} className={panel === "skip" ? "bg-accent" : ""}>
          <X className="h-4 w-4" /> Nicht nötig
        </Button>
      </div>
      {panel === "teach" && (
        <TeachBox
          messageId={s.message.id} fromAddr={s.message.from_addr} onCancel={() => setPanel(null)}
          title="Was ist Sache – und was soll stattdessen passieren?"
          placeholder="z. B. „Kein neues Projekt – gehört zu WER-1820, nur ins Logbuch.“ oder „Das ist eine Lieferantenrechnung, kein Kunde.“"
          footnote="Dieser Vorschlag wird verworfen und die Mail mit deinem Hinweis neu verarbeitet – danach liegt hier der neue Vorschlag."
        />
      )}
      {panel === "skip" && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <div className="text-sm font-medium">Vorschlag verwerfen</div>
          <p className="text-xs text-muted-foreground">Es passiert nichts – in HERO und im Postfach bleibt alles, wie es ist. Der Grund hilft dem Assistenten, so etwas künftig seltener vorzuschlagen.</p>
          <div className="flex flex-wrap gap-1.5">
            {SKIP_REASONS.map((r) => (
              <button
                key={r} type="button" onClick={() => setReason(r)}
                className={cn("rounded-full border px-3 py-1 text-xs", reason === r ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
              >{r}</button>
            ))}
          </div>
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Grund (optional)" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onReject(reason)} disabled={busy}>{busy && <Spinner />} Verwerfen</Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Abbrechen</Button>
          </div>
        </div>
      )}
    </div>
  );
}
