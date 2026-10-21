import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { invokeFn } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { Badge, Button, CardHeader, CardTitle, Spinner } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { TeachBox } from "@/components/TeachBox";
import { errorText, formatDateTime, pct } from "@/lib/utils";

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
      if (v.decision === "reject") toast("Abgelehnt – der Assistent merkt es sich.");
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

export function Buttons({ s, onAccept, onReject, acceptLabel, busy, disabled }: { s: Suggestion; onAccept: () => void; onReject: () => void; acceptLabel: string; busy: boolean; disabled?: boolean }) {
  const [teach, setTeach] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAccept} disabled={busy || disabled}>{busy ? <Spinner /> : null} {acceptLabel}</Button>
        <Button variant="outline" onClick={onReject} disabled={busy}>Ablehnen</Button>
        <Button variant="ghost" onClick={() => setTeach(!teach)} disabled={busy} className={teach ? "bg-accent" : ""}>
          <GraduationCap className="h-4 w-4" /> Falsch? Erklären
        </Button>
      </div>
      {teach && <TeachBox messageId={s.message.id} fromAddr={s.message.from_addr} onCancel={() => setTeach(false)} />}
    </div>
  );
}

