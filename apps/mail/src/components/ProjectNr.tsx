import { cn } from "@/lib/utils";

/**
 * Die HERO-Projektnummer – überall das auffälligste Merkmal einer Karte.
 * Zugeordnet: gefüllt (WER-1947) · Projekt noch offen („Projekt?“): gestrichelt ocker · kein Projekt: gestrichelt grau.
 */
export type ProjectNrKind = "assigned" | "open" | "none";

const KIND: Record<ProjectNrKind, string> = {
  assigned: "border border-[#C5CFDC] bg-[#E3E8EF] font-bold text-[#2C3E55] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100",
  open: "border border-dashed border-[#B45309] font-semibold text-[#78350F] dark:border-amber-500 dark:text-amber-300",
  none: "border border-dashed border-[#8792A2] font-medium text-[#556070] dark:border-slate-500 dark:text-slate-400",
};
const SIZE = { stack: "px-2 py-0.5 text-[13px]", head: "px-2.5 py-0.5 text-lg" } as const;

export function ProjectNr({ kind, nr, size = "stack", className }: { kind: ProjectNrKind; nr?: string | null; size?: keyof typeof SIZE; className?: string }) {
  const text = kind === "assigned" ? nr || "WER-?" : kind === "open" ? "Projekt?" : "ohne Projekt";
  return (
    <span
      className={cn("inline-block shrink-0 whitespace-nowrap rounded leading-tight", SIZE[size], KIND[kind], className)}
      title={kind === "open" ? "Neu oder bestehend – noch zu entscheiden" : kind === "none" ? "Kein Projekt zugeordnet" : undefined}
    >{text}</span>
  );
}
