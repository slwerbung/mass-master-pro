import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Project } from "@/types/project";
import { SIGN_STATUS_LABELS, SignPlanData, alive } from "@/types/signPlan";
import {
  boqTotals, buildBoq, formatNumber, labelLinesOfPositionType, resolveLineText,
  resolveLineTextSecondary, signCountOfPosition, sortedDestinations, sortedFloors,
  sortedPositions, sortedTypes, typesOfPosition,
} from "@/lib/signPlanLogic";
import { SIGN_ARROWS } from "@/types/signPlan";
import { buildXlsx, CellValue } from "@/lib/xlsxWriter";
import { downloadBlob } from "@/lib/exportUtils";

interface Props {
  project: Project;
  data: SignPlanData;
}

/**
 * Stueckliste, gruppiert nach Typ, Nachtraege separat ausgewiesen.
 *
 * Bildschirm und Excel-Export rechnen ueber dieselbe Funktion (`buildBoq`),
 * damit die Zahlen nicht auseinanderlaufen koennen. Dieselbe Regel steht auch
 * in der Datenbank-View `sign_bill_of_quantities`.
 */
const BoqTab = ({ project, data }: Props) => {
  const [isExporting, setIsExporting] = useState(false);

  const rows = useMemo(() => buildBoq(data), [data]);
  const regular = rows.filter((row) => !row.isAddition);
  const additions = rows.filter((row) => row.isAddition);
  const totalsRegular = boqTotals(regular);
  const totalsAdditions = boqTotals(additions);
  const totalsAll = boqTotals(rows);

  const dropped = alive(data.positions).filter((position) => position.status === "entfallen").length;

  const exportXlsx = async () => {
    setIsExporting(true);
    try {
      const floors = sortedFloors(data);
      const types = sortedTypes(data);
      const destinations = sortedDestinations(data);

      const boqSheet: CellValue[][] = [
        ["Kürzel", "Bezeichnung", "Breite (mm)", "Höhe (mm)", "Material", "Montageart",
          "Nachtrag", "Menge", "Fläche (m²)", "Einzelpreis (€)", "Gesamt (€)"],
        ...rows.map((row) => [
          row.code, row.name, row.widthMm, row.heightMm, row.material, row.mounting,
          row.isAddition ? "ja" : "nein", row.quantity,
          Number(row.areaSqm.toFixed(3)), row.unitPrice,
          row.totalPrice === null ? null : Number(row.totalPrice.toFixed(2)),
        ]),
        [],
        ["Summe Hauptauftrag", null, null, null, null, null, null,
          totalsRegular.quantity, Number(totalsRegular.areaSqm.toFixed(3)), null,
          Number(totalsRegular.totalPrice.toFixed(2))],
        ["Summe Nachträge", null, null, null, null, null, null,
          totalsAdditions.quantity, Number(totalsAdditions.areaSqm.toFixed(3)), null,
          Number(totalsAdditions.totalPrice.toFixed(2))],
        ["Summe gesamt", null, null, null, null, null, null,
          totalsAll.quantity, Number(totalsAll.areaSqm.toFixed(3)), null,
          Number(totalsAll.totalPrice.toFixed(2))],
      ];

      const positionSheet: CellValue[][] = [
        ["Position", "Geschoss", "Bezeichnung", "Status", "Nachtrag", "Typen", "Schilder"],
        ...sortedPositions(data).map((position) => {
          const floor = floors.find((f) => f.id === position.floorId);
          const links = typesOfPosition(data, position.id);
          const typeText = links
            .map((link) => {
              const type = types.find((t) => t.id === link.signTypeId);
              return `${type?.code ?? "?"}${link.quantity > 1 ? ` x${link.quantity}` : ""}`;
            })
            .join(", ");
          return [
            position.positionNumber,
            floor ? `${floor.code} · ${floor.name}` : "",
            position.title,
            SIGN_STATUS_LABELS[position.status],
            position.isAddition ? "ja" : "nein",
            typeText,
            signCountOfPosition(data, position.id),
          ];
        }),
      ];

      const labelSheet: CellValue[][] = [
        ["Position", "Typ", "Zeile", "Text", "Zweite Sprache", "Pfeil", "Piktogramm", "Taktil", "Braille"],
      ];
      for (const position of sortedPositions(data)) {
        for (const link of typesOfPosition(data, position.id)) {
          const type = types.find((t) => t.id === link.signTypeId);
          labelLinesOfPositionType(data, link.id).forEach((line, index) => {
            labelSheet.push([
              position.positionNumber,
              type?.code ?? "?",
              index + 1,
              resolveLineText(line, destinations),
              resolveLineTextSecondary(line, destinations),
              SIGN_ARROWS.find((arrow) => arrow.value === line.arrow)?.label ?? "",
              line.pictogram,
              line.isTactile ? "ja" : "nein",
              line.isBraille ? "ja" : "nein",
            ]);
          });
        }
      }

      const blob = await buildXlsx([
        { name: "Stückliste", rows: boqSheet, columnWidths: [10, 28, 12, 12, 30, 26, 10, 8, 12, 14, 14] },
        { name: "Positionen", rows: positionSheet, columnWidths: [12, 24, 30, 14, 10, 22, 10] },
        { name: "Beschriftung", rows: labelSheet, columnWidths: [12, 10, 8, 28, 24, 16, 16, 8, 8] },
      ]);

      const safeName = project.projectNumber.replace(/[^\w\-. ]+/g, "_").trim() || "Projekt";
      await downloadBlob(blob, `${safeName}_Stueckliste.xlsx`);
      toast.success("Stückliste exportiert");
    } catch (error) {
      console.error("Excel-Export fehlgeschlagen", error);
      toast.error("Export fehlgeschlagen");
    } finally {
      setIsExporting(false);
    }
  };

  const renderRows = (subset: typeof rows) => subset.map((row) => (
    <tr key={`${row.signTypeId}-${row.isAddition}`} className="border-b last:border-0">
      <td className="py-2 pr-3 font-medium whitespace-nowrap">{row.code}</td>
      <td className="py-2 pr-3">{row.name}</td>
      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
        {row.widthMm && row.heightMm ? `${row.widthMm} × ${row.heightMm}` : "–"}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{row.quantity}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(row.areaSqm, 3)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
        {row.unitPrice === null ? "–" : formatNumber(row.unitPrice)}
      </td>
      <td className="py-2 text-right tabular-nums font-medium">
        {row.totalPrice === null ? "–" : formatNumber(row.totalPrice)}
      </td>
    </tr>
  ));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {totalsAll.quantity} Schild(er) · {formatNumber(totalsAll.areaSqm, 3)} m²
        </p>
        <Button size="sm" onClick={exportXlsx} disabled={isExporting || rows.length === 0}>
          {isExporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          Excel-Export
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Noch nichts zu zählen – Positionen brauchen mindestens einen zugeordneten Schildtyp.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[40rem]">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 text-left">Kürzel</th>
                  <th className="py-2 pr-3 text-left">Bezeichnung</th>
                  <th className="py-2 pr-3 text-left">Maße (mm)</th>
                  <th className="py-2 pr-3 text-right">Menge</th>
                  <th className="py-2 pr-3 text-right">Fläche m²</th>
                  <th className="py-2 pr-3 text-right">Einzel €</th>
                  <th className="py-2 text-right">Gesamt €</th>
                </tr>
              </thead>
              <tbody>
                {renderRows(regular)}
                {regular.length > 0 && (
                  <tr className="border-b-2 font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>Summe Hauptauftrag</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{totalsRegular.quantity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(totalsRegular.areaSqm, 3)}</td>
                    <td className="py-2 pr-3" />
                    <td className="py-2 text-right tabular-nums">{formatNumber(totalsRegular.totalPrice)}</td>
                  </tr>
                )}

                {additions.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={7} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Nachträge
                      </td>
                    </tr>
                    {renderRows(additions)}
                    <tr className="border-b-2 font-semibold">
                      <td className="py-2 pr-3" colSpan={3}>Summe Nachträge</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{totalsAdditions.quantity}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(totalsAdditions.areaSqm, 3)}</td>
                      <td className="py-2 pr-3" />
                      <td className="py-2 text-right tabular-nums">{formatNumber(totalsAdditions.totalPrice)}</td>
                    </tr>
                  </>
                )}

                <tr className="font-bold">
                  <td className="py-2 pr-3" colSpan={3}>Summe gesamt</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{totalsAll.quantity}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(totalsAll.areaSqm, 3)}</td>
                  <td className="py-2 pr-3" />
                  <td className="py-2 text-right tabular-nums">{formatNumber(totalsAll.totalPrice)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground px-1">
        Positionen mit dem Status „Entfallen“ zählen nicht mit
        {dropped > 0 ? ` (aktuell ${dropped}).` : "."} Die Excel-Datei enthält zusätzlich
        die Blätter „Positionen“ und „Beschriftung“ – damit lassen sich die Zahlen gegen die
        Standortliste prüfen.
      </p>
    </div>
  );
};

export default BoqTab;
