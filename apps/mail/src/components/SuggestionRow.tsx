import type { ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui";
import { SKIP_REASONS } from "@/lib/decide";
import { cn } from "@/lib/utils";

export type RowStatus = "open" | "accepted" | "rejected";

/**
 * Eine Vorschlagszeile in „Zu entscheiden“: Checkbox (große Trefferfläche) · Kurztext · Pfeil.
 * Klick auf den Text klappt die Felder auf (und hakt die Zeile an). Haken weg = wird beim Ausführen verworfen;
 * dann erscheinen die Grund-Chips (optional).
 */
export function SuggestionRow({ id, text, checked, open, status, reason, selectable = true, onChecked, onToggle, onReason, children, note }: {
  id: string; text: string; checked: boolean; open: boolean; status: RowStatus; reason: string;
  /** false: keine Checkbox (z. B. „Prüfen & senden“ gehört nicht zu „Ausführen“) */
  selectable?: boolean;
  onChecked: (v: boolean) => void; onToggle: () => void; onReason: (r: string) => void; children?: ReactNode; note?: string;
}) {
  const done = status !== "open";
  return (
    <li className={cn("rounded-md border bg-background", done && "bg-muted/40")}>
      <div className="flex items-stretch">
        <div className="flex w-8 shrink-0 items-center justify-center max-md:w-11" style={{ minHeight: 32 }}>
          {status === "accepted" ? <Check className="h-4 w-4 text-emerald-600" aria-label="erledigt" />
            : status === "rejected" ? <span className="text-muted-foreground" aria-label="verworfen">–</span>
              : selectable ? (
                <label className="flex h-full w-full cursor-pointer items-center justify-center max-md:min-h-11">
                  <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChecked(e.target.checked)} aria-label={`${text} ausführen`} />
                </label>
              ) : null}
        </div>
        <button
          type="button" aria-expanded={open} aria-controls={`row-${id}`} onClick={onToggle} disabled={done}
          className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
        >
          <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground")}>{text}</span>
          {done && <span className="shrink-0 text-xs text-muted-foreground">{status === "accepted" ? "erledigt" : `verworfen (${reason || "Nicht nötig"})`}</span>}
          {!done && <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />}
        </button>
      </div>
      {open && !done && <div id={`row-${id}`} className="space-y-3 border-t bg-muted/20 p-3">{children}</div>}
      {!checked && !done && selectable && (
        <div className="space-y-2 border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">{note ?? "Wird beim Ausführen verworfen – in HERO und im Postfach ändert sich nichts. Der Grund hilft dem Assistenten (optional):"}</p>
          <div className="flex flex-wrap gap-1.5">
            {SKIP_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => onReason(reason === r ? "" : r)}
                className={cn("touch-manipulation rounded-full border px-3 py-1 text-xs hover:bg-accent max-md:min-h-9", reason === r ? "border-primary bg-primary text-primary-foreground hover:bg-primary" : "bg-background")}>{r}</button>
            ))}
          </div>
          <Input value={reason} maxLength={300} onChange={(e) => onReason(e.target.value)} placeholder="Eigener Grund, z. B. „Kunde hat angerufen“ …" aria-label="Grund" />
        </div>
      )}
    </li>
  );
}
