import type React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/** Projekt in der HERO-Weboberflaeche (project_match.id, wie in CaptFix). */
export const heroProjectUrl = (id: number | string) => `https://login.hero-software.de/partner/Projects/view/${id}`;

/**
 * Link „in HERO öffnen“ – neuer Tab, Klick löst nichts in der umgebenden Zeile/Karte aus.
 * `inLink`: steht in einem anderen Link (Mail-Liste) – dann ein <span> statt verschachteltem <a>.
 */
export function HeroLink({ id, nr, label, className, inLink }: { id: number | string | null | undefined; nr?: string | null; label?: string; className?: string; inLink?: boolean }) {
  if (!id) return null;
  const cls = cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950", className);
  const body = <><ExternalLink className="h-3 w-3 shrink-0" />{label ?? nr ?? `HERO #${id}`}</>;
  if (inLink) {
    const open = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); window.open(heroProjectUrl(id), "_blank", "noopener"); };
    return (
      <span role="link" tabIndex={0} title="Projekt in HERO öffnen" className={cn(cls, "cursor-pointer")}
        onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(e); }}>{body}</span>
    );
  }
  return (
    <a href={heroProjectUrl(id)} target="_blank" rel="noreferrer" title="Projekt in HERO öffnen" onClick={(e) => e.stopPropagation()} className={cls}>{body}</a>
  );
}
