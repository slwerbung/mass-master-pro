import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { SIGN_POSITION_STATUSES, SIGN_STATUS_LABELS, SignPlanData } from "@/types/signPlan";
import { ALL, SignPositionFilter, emptyFilter, isFilterActive, sortedFloors, sortedTypes } from "@/lib/signPlanLogic";

interface Props {
  data: SignPlanData;
  filter: SignPositionFilter;
  onChange: (filter: SignPositionFilter) => void;
  showSearch?: boolean;
}

/** Gemeinsame Filterleiste für Positionsliste und Plan – damit beide Ansichten
 *  denselben Ausschnitt zeigen, wenn man zwischen ihnen wechselt. */
const FilterBar = ({ data, filter, onChange, showSearch = true }: Props) => {
  const floors = sortedFloors(data);
  const types = sortedTypes(data);

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={filter.floorId} onValueChange={(value) => onChange({ ...filter, floorId: value })}>
        <SelectTrigger className="h-9 w-auto min-w-[9rem] flex-1 sm:flex-none"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Alle Geschosse</SelectItem>
          {floors.map((floor) => (
            <SelectItem key={floor.id} value={floor.id}>{floor.code} · {floor.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.typeId} onValueChange={(value) => onChange({ ...filter, typeId: value })}>
        <SelectTrigger className="h-9 w-auto min-w-[9rem] flex-1 sm:flex-none"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Alle Typen</SelectItem>
          {types.map((type) => (
            <SelectItem key={type.id} value={type.id}>{type.code}{type.name ? ` · ${type.name}` : ""}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.status} onValueChange={(value) => onChange({ ...filter, status: value })}>
        <SelectTrigger className="h-9 w-auto min-w-[9rem] flex-1 sm:flex-none"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Alle Status</SelectItem>
          {SIGN_POSITION_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>{SIGN_STATUS_LABELS[status]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showSearch && (
        <Input
          className="h-9 flex-1 min-w-[10rem]"
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          placeholder="Nummer oder Bezeichnung"
        />
      )}

      {isFilterActive(filter) && (
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => onChange(emptyFilter())} title="Filter zurücksetzen">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

export default FilterBar;
