import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Settings, ChevronDown } from "lucide-react";
import { useState } from "react";

export interface PDFExportOptions {
  includeProjectHeader: boolean;
  includeLocationNumber: boolean;
  includeLocationName: boolean;
  includeAnnotatedImage: boolean;
  includeOriginalImage: boolean;
  includeComment: boolean;
  includeCreatedDate: boolean;
}

export const defaultPDFOptions: PDFExportOptions = {
  includeProjectHeader: true,
  includeLocationNumber: true,
  includeLocationName: true,
  includeAnnotatedImage: true,
  includeOriginalImage: false,
  includeComment: true,
  includeCreatedDate: true,
};

interface Props {
  options: PDFExportOptions;
  onChange: (options: PDFExportOptions) => void;
}

const PDFExportOptionsUI = ({ options, onChange }: Props) => {
  const [open, setOpen] = useState(false);

  const toggle = (key: keyof PDFExportOptions) => {
    onChange({ ...options, [key]: !options[key] });
  };

  const items: { key: keyof PDFExportOptions; label: string; group: string }[] = [
    { key: "includeProjectHeader", label: "Projektnummer", group: "Allgemein" },
    { key: "includeLocationNumber", label: "Standortnummer", group: "Allgemein" },
    { key: "includeLocationName", label: "Standortname", group: "Allgemein" },
    { key: "includeCreatedDate", label: "Erstellungsdatum", group: "Allgemein" },
    { key: "includeAnnotatedImage", label: "Bemaßtes Bild", group: "Bilder" },
    { key: "includeOriginalImage", label: "Originalbild (unbearbeitet)", group: "Bilder" },
    { key: "includeComment", label: "Kommentar", group: "Inhalt" },
  ];

  const groups = ["Allgemein", "Bilder", "Inhalt"];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between mb-2">
          <span className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Export-Optionen anpassen
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pb-4">
        {groups.map((group) => (
          <div key={group} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {group}
            </p>
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <div key={item.key} className="flex items-center gap-2">
                  <Checkbox
                    id={item.key}
                    checked={options[item.key]}
                    onCheckedChange={() => toggle(item.key)}
                  />
                  <Label htmlFor={item.key} className="text-sm cursor-pointer">
                    {item.label}
                  </Label>
                </div>
              ))}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default PDFExportOptionsUI;
