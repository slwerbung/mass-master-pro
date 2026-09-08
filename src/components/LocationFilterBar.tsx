import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { Location } from "@/types/project";
import { BaseFieldConfig } from "@/lib/customerFields";
import {
  ALL_VALUES, LocationFilter, emptyLocationFilter, filterableFields, isLocationFilterActive,
} from "@/lib/locationFilter";

interface Props {
  locations: Location[];
  fieldConfigs: Pick<BaseFieldConfig, "field_key" | "field_label" | "field_type" | "is_active">[];
  filter: LocationFilter;
  onChange: (filter: LocationFilter) => void;
  /** Anzahl nach dem Filtern, fuer die Trefferanzeige. */
  visibleCount: number;
  totalCount: number;
}

/**
 * Filterleiste ueber der Standortliste.
 *
 * Die Auswahlfelder entstehen aus der Feldkonfiguration und den Werten, die im
 * Projekt tatsaechlich vorkommen – ein neu angelegtes Standortfeld ist damit
 * automatisch filterbar, ohne dass hier etwas nachgezogen werden muss.
 */
const LocationFilterBar = ({ locations, fieldConfigs, filter, onChange, visibleCount, totalCount }: Props) => {
  const fields = useMemo(() => filterableFields(locations, fieldConfigs), [locations, fieldConfigs]);
  const active = isLocationFilterActive(filter);

  // Ohne Auswahlfelder und mit einer Handvoll Standorte lohnt die Leiste nicht.
  if (fields.length === 0 && totalCount < 8) return null;

  const setValue = (fieldKey: string, value: string) =>
    onChange({ ...filter, values: { ...filter.values, [fieldKey]: value } });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-9"
            value={filter.search}
            onChange={(e) => onChange({ ...filter, search: e.target.value })}
            placeholder="Standorte durchsuchen"
          />
        </div>

        {fields.map((field) => (
          <Select
            key={field.fieldKey}
            value={filter.values[field.fieldKey] || ALL_VALUES}
            onValueChange={(value) => setValue(field.fieldKey, value)}
          >
            <SelectTrigger className="h-9 w-auto min-w-[8.5rem] flex-1 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUES}>{field.label}: alle</SelectItem>
              {field.values.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {active && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => onChange(emptyLocationFilter())}
            title="Filter zurücksetzen"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {active && (
        <p className="text-xs text-muted-foreground px-0.5">
          {visibleCount} von {totalCount} Standorten
        </p>
      )}
    </div>
  );
};

export default LocationFilterBar;
