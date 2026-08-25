// Foil-amount (waste) calculation. The amount to buy follows directly from the
// nesting result: folienbreite × length is the actually consumed foil (gross
// area, incl. waste). No rounding to full metres — exact values are shown.

import type { FolienMenge, MengenOptions, NestingOptions, PackResult, Teil } from "./types";

export const DEFAULT_MENGEN_OPTIONS: MengenOptions = {
  sicherheitszuschlag: 0,
};

export function berechneFolienMenge(
  teile: Teil[], r: PackResult, opt: NestingOptions, mengen: MengenOptions,
): FolienMenge {
  const netto = teile.reduce((s, t) => s + t.breite * t.hoehe, 0) / 1e6;
  const zugabe = teile.reduce(
    (s, t) => s + (t.breite + 2 * opt.zugabe) * (t.hoehe + 2 * opt.zugabe), 0) / 1e6;
  const lfm = (r.laengeMm / 1000) * (1 + mengen.sicherheitszuschlag);
  const brutto = (r.folienbreite / 1000) * lfm;

  return {
    nettoFlaecheM2: netto,
    zugabeFlaecheM2: zugabe,
    laufmeter: lfm,
    bruttoFlaecheM2: brutto,
    verschnittM2: brutto - netto,
    verschnittProzent: brutto > 0 ? (brutto - netto) / brutto * 100 : 0,
    ausnutzungProzent: brutto > 0 ? netto / brutto * 100 : 0,
    mehrbedarfProzent: netto > 0 ? (brutto / netto - 1) * 100 : 0,
  };
}
