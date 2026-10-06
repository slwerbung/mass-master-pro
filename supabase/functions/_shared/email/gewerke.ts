// Gewerk (WER, TEX …) fuer ein neues Projekt waehlen. Die Zuordnung steht im
// Admin-Bereich (`email_config.gewerke`), nichts davon ist fest verdrahtet.

export interface Gewerk {
  short: string;
  name: string;
  measure_id: number | null;
  default?: boolean;
  services?: string[];
  keywords?: string[];
}

export function pickGewerk(
  gewerke: Gewerk[], ctx: { service: string | null; text: string },
): Gewerk | null {
  if (!gewerke.length) return null;
  const def = gewerke.find((g) => g.default) ?? gewerke[0];
  const text = ctx.text.toLowerCase();
  for (const g of gewerke) {
    if (g === def && !g.services?.length && !g.keywords?.length) continue;
    if (ctx.service && g.services?.some((s) => s.toLowerCase() === ctx.service!.toLowerCase())) return g;
  }
  for (const g of gewerke) {
    if (g.default) continue;
    if (g.keywords?.some((k) => k && text.includes(k.toLowerCase()))) return g;
  }
  return def;
}
