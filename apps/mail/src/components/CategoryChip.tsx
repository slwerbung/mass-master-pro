import { Badge } from "@/components/ui";
import { CATEGORY_LABELS, type Category } from "@/lib/shared";

const tone: Partial<Record<Category, "default" | "warn" | "danger" | "good" | "secondary">> = {
  anfrage_neu: "good", projekt_kommunikation: "default", layout_freigabe: "default", auftrag: "good",
  reklamation: "danger", werbung_spam: "secondary", newsletter: "secondary", system: "secondary",
};

export function CategoryChip({ category }: { category: Category | null | undefined }) {
  if (!category) return <Badge variant="outline">–</Badge>;
  return <Badge variant={tone[category] ?? "warn"}>{CATEGORY_LABELS[category] ?? category}</Badge>;
}
