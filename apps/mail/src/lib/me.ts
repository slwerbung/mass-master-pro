import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CATEGORIES, type Category } from "@/lib/shared";

export interface Me {
  name: string;
  email: string | null;
  admin: boolean;
  role?: "admin" | "mitarbeiter";
  accountIds?: string[] | null;
  /** Kategorien, die dieser Benutzer nicht sieht (fehlt bei einer aelteren email-api) */
  hiddenCategories?: string[];
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("me"), retry: false });

/** Kategorien, die der Benutzer sieht (Admins: alle). */
export const visibleCategories = (me: Me | undefined, list: readonly Category[] = CATEGORIES): Category[] =>
  list.filter((c) => !(me?.hiddenCategories ?? []).includes(c));
