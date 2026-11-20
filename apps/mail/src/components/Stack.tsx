import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Handy (< 768 px, `md:`): der Stapel ist eine Liste, die Karte klappt unter dem Eintrag auf. */
export function useIsMobile(): boolean {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Rahmen eines Stapel-Eintrags (aktiv/hover). `joined`: die Karte klappt direkt darunter auf (Handy) –
 * der Eintrag ist unten eckig und die Karte schließt bündig an.
 */
export function StackItemFrame({ active, joined, onClick, children, className, ariaExpanded }: {
  active: boolean; joined?: boolean; onClick: () => void; children: ReactNode; className?: string; ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-expanded={ariaExpanded} aria-current={active ? "true" : undefined}
      className={cn(
        "block w-full min-w-0 touch-manipulation rounded-md border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary bg-accent", joined && "rounded-b-none border-b-0", className,
      )}
    >{children}</button>
  );
}

/**
 * Tasten des Stapels: J/K nächstes/voriges, dazu `keys` (Kleinbuchstabe → Aktion; „Enter“ nur, wenn kein Knopf/Link den Fokus hat).
 * Nicht in Eingabefeldern, nicht bei `disabled` (z. B. offener Dialog), nicht mit Strg/Alt/Cmd.
 */
export function useStackKeys({ onNext, onPrev, keys, disabled }: { onNext: () => void; onPrev: () => void; keys?: Record<string, () => void>; disabled?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const k = e.key === "Enter" ? "enter" : e.key.toLowerCase();
      if (k === "enter" && t && /^(BUTTON|A)$/.test(t.tagName)) return;
      if (k === "j") onNext();
      else if (k === "k") onPrev();
      else if (keys?.[k]) { e.preventDefault(); keys[k](); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
