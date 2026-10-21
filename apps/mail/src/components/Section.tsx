import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY = "mail-assistent:sections";
const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };

/**
 * Einklappbarer Bereich der Mail-Ansicht. Zugeklappt zeigt die Kopfzeile eine Kurzinfo (`summary`);
 * ob ein Bereich offen ist, merkt sich der Browser je Bereich (nicht je Mail).
 */
export function Section({ id, title, icon, summary, defaultOpen = false, tone, children }: {
  id: string; title: string; icon?: ReactNode; summary?: ReactNode; defaultOpen?: boolean; tone?: "warn"; children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => load()[id] ?? defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: next })); } catch { /* privater Modus */ }
  };
  return (
    <section className={cn("rounded-lg border bg-card", tone === "warn" && "border-amber-300")}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {icon}
        <span className="font-medium">{title}</span>
        {summary != null && <span className="ml-2 min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</span>}
      </button>
      {open && <div className="space-y-3 border-t px-4 py-3">{children}</div>}
    </section>
  );
}
