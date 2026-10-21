import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption { value: string; label: string; count?: number; hint?: string }

/**
 * Filter als Pille mit Ausklappmenü (wie in Gmail/Linear): zeigt den gewählten Wert, ein Klick auf das ×
 * setzt ihn zurück. Leerer Wert = „alle".
 */
export function FilterMenu({ label, icon, value, options, onChange, children, align = "left" }: {
  align?: "left" | "right";
  label: string; icon?: ReactNode; value: string; options?: FilterOption[]; onChange: (v: string) => void;
  /** Eigener Inhalt statt Optionsliste (z. B. Datumsfelder). */
  children?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const active = !!value;
  const shown = options?.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <div className={cn(
        "inline-flex h-8 items-center rounded-full border text-sm transition-colors",
        active ? "border-primary/40 bg-primary/10 text-primary" : "bg-background hover:bg-accent",
      )}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex h-full items-center gap-1.5 pl-3 pr-2">
          {icon}
          <span className={cn(active && "font-medium")}>{active ? shown : label}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", open && "rotate-180")} />
        </button>
        {active && (
          <button type="button" aria-label={`${label} zurücksetzen`} onClick={() => onChange("")} className="-ml-1 mr-1.5 rounded-full p-0.5 hover:bg-primary/20">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className={cn("absolute z-30 mt-1", align === "right" ? "right-0" : "left-0", "min-w-[14rem] rounded-lg border bg-card p-1 shadow-lg")}>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{label}</div>
          {children ? children(() => setOpen(false)) : (
            <div className="max-h-80 overflow-y-auto">
              {options?.map((o) => (
                <button
                  key={o.value || "_all"} type="button" title={o.hint}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", o.value === value && "font-medium")}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">{o.label}</span>
                  {o.count != null && <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
