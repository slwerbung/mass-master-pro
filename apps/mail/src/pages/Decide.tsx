import { Card, CardContent } from "@/components/ui";

// Wird in Phase 2/3 mit den Vorschlagskarten gefuellt.
export default function Decide() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Zu entscheiden</h1>
      <Card><CardContent className="p-6 text-sm text-muted-foreground">Keine offenen Vorschläge.</CardContent></Card>
    </div>
  );
}
