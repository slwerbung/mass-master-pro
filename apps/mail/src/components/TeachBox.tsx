import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { api, invokeFn } from "@/lib/api";
import { FREEMAIL_DOMAINS, type KnowledgeScope } from "@/lib/shared";
import { Button, Spinner, Textarea } from "@/components/ui";
import { cn, errorText } from "@/lib/utils";

const MAX = 1000;

/**
 * „Das ist falsch – richtig wäre …": Freitext an den Assistenten. Offene Vorschläge der Mail
 * werden verworfen, die Mail läuft mit dem Hinweis neu durch, und auf Wunsch landet der Satz
 * in der Wissensdatei (Einstellungen → Wissen).
 */
export function TeachBox({ messageId, fromAddr, onDone, onCancel, className, title, placeholder, footnote }: {
  messageId: string; fromAddr: string; onDone?: () => void; onCancel?: () => void; className?: string;
  title?: string; placeholder?: string; footnote?: string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<KnowledgeScope>("absender");
  const [knowledge, setKnowledge] = useState<string | null>(null); // null = folgt dem Hinweis
  const addr = fromAddr.trim().toLowerCase();
  const domain = addr.includes("@") ? addr.slice(addr.lastIndexOf("@") + 1) : "";
  const scopes: { key: KnowledgeScope; label: string; hidden?: boolean }[] = [
    { key: "keine", label: "Nur diese Mail" },
    { key: "absender", label: `Absender ${addr}`, hidden: !addr.includes("@") },
    { key: "domain", label: `Alle von @${domain}`, hidden: !domain || FREEMAIL_DOMAINS.includes(domain) },
    { key: "alle", label: "Alle Mails" },
  ];

  const teach = useMutation({
    mutationFn: () => api<{ accountId: string; knowledgeId: string | null; rejected: number }>("teach", {
      id: messageId, text: note, remember: scope, knowledgeText: scope === "keine" ? undefined : (knowledge ?? note),
    }),
    onSuccess: (r) => {
      toast.success(
        `${r.knowledgeId ? "In die Wissensdatei übernommen. " : ""}${r.rejected ? `${r.rejected} Vorschlag/Vorschläge verworfen. ` : ""}Die Mail wird mit deinem Hinweis neu verarbeitet …`,
      );
      const refresh = () => ["message", "messages", "suggestions", "overview", "knowledge"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      refresh();
      onDone?.();
      // Gleich verarbeiten statt auf den naechsten Cron-Lauf zu warten; laeuft im Hintergrund weiter.
      invokeFn<{ skipped?: string; error?: string }[]>("email-process", { accountId: r.accountId })
        .then((res) => {
          refresh();
          if (res?.[0]?.skipped || res?.[0]?.error) toast("Läuft gerade schon – die Mail kommt beim nächsten Lauf dran.");
          else toast.success("Neu verarbeitet – bitte das Ergebnis prüfen.");
        })
        .catch(() => toast("Die Mail kommt beim nächsten Lauf (spätestens in 5 Minuten) dran."));
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <div className={cn("space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3", className)}>
      <div className="flex items-center gap-2 text-sm font-medium"><GraduationCap className="h-4 w-4" /> {title ?? "Was wäre richtig?"}</div>
      <Textarea
        rows={3} maxLength={MAX} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
        placeholder={placeholder ?? "z. B. „Das ist keine neue Anfrage, sondern gehört zum Projekt Carport Müller (WER-1820).“ oder „Rechnungen von Probo sind Lieferanten-Belege.“"}
      />
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Merken für künftige Mails</div>
        <div className="flex flex-wrap gap-1.5">
          {scopes.filter((s) => !s.hidden).map((s) => (
            <button
              key={s.key} type="button" onClick={() => setScope(s.key)}
              className={cn("max-w-full truncate rounded-full border px-3 py-1 text-xs", scope === s.key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
            >{s.label}</button>
          ))}
        </div>
      </div>
      {scope !== "keine" && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Eintrag in der Wissensdatei – am besten allgemein formulieren</div>
          <Textarea rows={2} maxLength={MAX} value={knowledge ?? note} onChange={(e) => setKnowledge(e.target.value)} placeholder="Wird aus deinem Hinweis übernommen" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => teach.mutate()} disabled={note.trim().length < 3 || teach.isPending}>
          {teach.isPending && <Spinner />} Korrigieren &amp; neu verarbeiten
        </Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Abbrechen</Button>}
        <span className="text-xs text-muted-foreground">{footnote ?? "Offene Vorschläge zu dieser Mail werden dabei verworfen."}</span>
      </div>
    </div>
  );
}
