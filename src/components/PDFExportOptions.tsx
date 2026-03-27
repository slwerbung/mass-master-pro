import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Shield, Users } from "lucide-react";

export type PDFExportMode = "internal" | "customer";

export interface PDFExportOptions {
  mode: PDFExportMode;
}

export const defaultPDFOptions: PDFExportOptions = {
  mode: "internal",
};

interface Props {
  options: PDFExportOptions;
  onChange: (options: PDFExportOptions) => void;
}

const MODE_COPY: Record<PDFExportMode, { title: string; description: string; icon: typeof Shield }> = {
  internal: {
    title: "Interner Export",
    description: "Zeigt die interne Ansicht mit allen aktiven Feldern, Detailbildern und internen Inhalten.",
    icon: Shield,
  },
  customer: {
    title: "Kunden-Export",
    description: "Zeigt die Kundenansicht. Sichtbare Inhalte richten sich nach den Einstellungen im Admin-Menü.",
    icon: Users,
  },
};

const PDFExportOptionsUI = ({ options, onChange }: Props) => {
  const setMode = (mode: PDFExportMode) => onChange({ ...options, mode });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Exportansicht</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Du wählst nur noch zwischen <strong>Intern</strong> und <strong>Kunde</strong>. Welche Felder im Kunden-Export sichtbar sind, wird im Admin-Menü gesteuert.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["internal", "customer"] as PDFExportMode[]).map((mode) => {
          const active = options.mode === mode;
          const Icon = MODE_COPY[mode].icon;
          return (
            <Card key={mode} className={active ? "border-primary ring-1 ring-primary/30" : "border-border"}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">{MODE_COPY[mode].title}</p>
                      <p className="text-sm text-muted-foreground">{MODE_COPY[mode].description}</p>
                    </div>
                  </div>
                  {active && <Badge>Aktiv</Badge>}
                </div>
                <Button variant={active ? "default" : "outline"} className="w-full" onClick={() => setMode(mode)}>
                  {active ? "Ausgewählt" : "Auswählen"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default PDFExportOptionsUI;
