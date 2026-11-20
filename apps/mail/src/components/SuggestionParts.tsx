import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeFn } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { errorText } from "@/lib/utils";

// Gemeinsame Bausteine der Vorschläge („Zu entscheiden"). Die Felder je Art stehen in SuggestionFields.tsx / OrderCards.tsx,
// die Zeile in SuggestionRow.tsx, „Ausführen“ in pages/Decide.tsx.

const LISTS = ["suggestions", "overview", "messages", "topics"];

export function useDecide(s: Suggestion, successText?: (r: Record<string, any>) => string) {
  const qc = useQueryClient();
  const done = () => LISTS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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

/** Eine Entscheidung ohne Oberfläche (für „Ausführen“): annehmen oder verwerfen, Fehler werfen. */
export async function decideSuggestion(id: string, decision: "accept" | "reject", edits?: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return invokeFn<{ warnings?: string[]; projectNr?: string } & Record<string, any>>("email-action", { action: "decide", suggestionId: id, decision, edits });
}

export interface ExistingCustomer { id: number; name: string; email: string; via: "email" | "domain" | "firma" }
const VIA: Record<ExistingCustomer["via"], string> = { email: "über die E-Mail-Adresse", domain: "über die Firmen-Domain", firma: "über den Firmennamen" };

/** Den Kunden gibt es schon in HERO: Projekt dort anlegen oder (bei falschem Treffer) doch einen neuen Kontakt. */
export function ExistingCustomerChoice({ customer, useExisting, onChange }: { customer: ExistingCustomer; useExisting: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <p>Den Kunden gibt es schon in HERO: <b>{customer.name}</b>{customer.email ? ` (${customer.email})` : ""} – gefunden {VIA[customer.via] ?? ""}.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-2"><input type="radio" checked={useExisting} onChange={() => onChange(true)} /> Projekt bei diesem Kunden anlegen</label>
        <label className="flex items-center gap-2"><input type="radio" checked={!useExisting} onChange={() => onChange(false)} /> Falscher Kunde – neuen Kontakt anlegen</label>
      </div>
    </div>
  );
}
