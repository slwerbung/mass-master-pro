import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Scissors, Download, ChevronDown, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { downloadBlob } from "@/lib/exportUtils";
import type { FolienMenge, NestingOptions, PackResult, Teil } from "./types";
import { DEFAULT_OPTIONS, nesting } from "./nesting";
import { berechneFolienMenge } from "./folienmenge";
import { parseText, teileZuText } from "./parse";
import { buildSvg, computeLayout } from "./svg";

interface NestingPanelProps {
  /** Parts prefilled from the project's Flächenaufmaß. */
  initialTeile: Teil[];
  projektnummer: string;
}

const f2 = (n: number) => n.toFixed(2).replace(".", ",");
const f1 = (n: number) => n.toFixed(1).replace(".", ",");

export default function NestingPanel({ initialTeile, projektnummer }: NestingPanelProps) {
  const [text, setText] = useState(() => teileZuText(initialTeile));
  const [autoBreite, setAutoBreite] = useState(DEFAULT_OPTIONS.autoBreite);
  const [folienbreite, setFolienbreite] = useState(String(DEFAULT_OPTIONS.folienbreite));
  const [kandidaten, setKandidaten] = useState(DEFAULT_OPTIONS.breitenKandidaten.join(", "));
  const [zugabe, setZugabe] = useState("0");
  const [optimierung, setOptimierung] = useState<NestingOptions["optimierung"]>(DEFAULT_OPTIONS.optimierung);
  const [stueckeln, setStueckeln] = useState(DEFAULT_OPTIONS.stueckeln);
  const [stueckelModus, setStueckelModus] = useState<NestingOptions["stueckelModus"]>(DEFAULT_OPTIONS.stueckelModus);
  const [maxLaengeM, setMaxLaengeM] = useState(String(DEFAULT_OPTIONS.maxLaengeMm / 1000)); // in metres
  const [spaltenAbstand, setSpaltenAbstand] = useState(String(DEFAULT_OPTIONS.spaltenAbstand));
  const [zuschlag, setZuschlag] = useState("0"); // % safety margin on length
  const [advOpen, setAdvOpen] = useState(false);
  const [rand, setRand] = useState(String(DEFAULT_OPTIONS.rand));
  const [abstand, setAbstand] = useState(String(DEFAULT_OPTIONS.abstand));
  const [reihenAbstand, setReihenAbstand] = useState(String(DEFAULT_OPTIONS.reihenAbstand));
  const [schriftgroesse, setSchriftgroesse] = useState(String(DEFAULT_OPTIONS.schriftgroesse));

  const [result, setResult] = useState<PackResult | null>(null);
  const [menge, setMenge] = useState<FolienMenge | null>(null);
  const [usedOpt, setUsedOpt] = useState<NestingOptions | null>(null);

  const num = (s: string, fallback: number) => {
    const n = parseFloat(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };

  const partCount = useMemo(() => parseText(text).length, [text]);

  const buildOptions = (): NestingOptions => {
    const cand = kandidaten
      .split(/[\s,;]+/)
      .map((s) => parseFloat(s.replace(",", ".")))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      ...DEFAULT_OPTIONS,
      folienbreite: Math.max(1, num(folienbreite, DEFAULT_OPTIONS.folienbreite)),
      autoBreite,
      breitenKandidaten: cand.length > 0 ? cand : DEFAULT_OPTIONS.breitenKandidaten,
      zugabe: Math.max(0, num(zugabe, 0)),
      optimierung,
      stueckeln,
      stueckelModus,
      maxLaengeMm: Math.max(0, num(maxLaengeM, 15)) * 1000,
      spaltenAbstand: Math.max(0, num(spaltenAbstand, DEFAULT_OPTIONS.spaltenAbstand)),
      rand: Math.max(0, num(rand, DEFAULT_OPTIONS.rand)),
      abstand: Math.max(0, num(abstand, DEFAULT_OPTIONS.abstand)),
      reihenAbstand: Math.max(0, num(reihenAbstand, DEFAULT_OPTIONS.reihenAbstand)),
      schriftgroesse: Math.max(1, num(schriftgroesse, DEFAULT_OPTIONS.schriftgroesse)),
      projektnummer,
    };
  };

  const handleCompute = () => {
    const teile = parseText(text);
    if (teile.length === 0) {
      toast.error("Keine gültigen Maße gefunden. Format: „F1: 500 x 300 mm“");
      return;
    }
    const opt = buildOptions();
    const r = nesting(teile, opt);
    const m = berechneFolienMenge(teile, r, opt, { sicherheitszuschlag: Math.max(0, num(zuschlag, 0)) / 100 });
    setResult(r);
    setMenge(m);
    setUsedOpt(opt);
    if (autoBreite) setFolienbreite(String(r.folienbreite)); // reflect chosen width
  };

  const handleDownload = async () => {
    if (!result || !usedOpt) return;
    const svg = buildSvg(result, usedOpt);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const safeNr = (projektnummer || "Projekt").replace(/[^A-Za-z0-9-]/g, "_");
    const name = `Flaechenzuschnitt_${safeNr}_${result.folienbreite}mm_${stamp}.svg`;
    const ok = await downloadBlob(blob, name);
    if (ok) toast.success("SVG gespeichert");
  };

  const zuGross = result?.teile.filter((t) => t.zuGross) ?? [];
  const gestueckeltCount = result?.teile.filter((t) => t.gestueckelt).length ?? 0;
  const layout = result && usedOpt ? computeLayout(result, usedOpt) : null;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scissors className="h-4 w-4 text-primary" /> Folienzuschnitt (Nesting)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Ordnet die bemessenen Flächen maßgetreu (mm) auf einer Folienbahn an und erzeugt ein SVG für CorelDRAW.
          Die reale Folienmenge inkl. Verschnitt wird berechnet.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="nest-text">Maße (aus dem Flächenaufmaß, editierbar)</Label>
          <Textarea
            id="nest-text"
            className="min-h-[120px] font-mono text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"F1: 500 x 300 mm\nF2: 1000 x 500 mm"}
          />
          <p className="text-xs text-muted-foreground">{partCount} Teil(e) erkannt.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nest-breite">Folienbreite (mm)</Label>
            <Input id="nest-breite" type="number" inputMode="numeric" value={folienbreite}
              onChange={(e) => setFolienbreite(e.target.value)} disabled={autoBreite} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nest-zugabe">Zugabe ringsum (mm)</Label>
            <Input id="nest-zugabe" type="number" inputMode="numeric" value={zugabe}
              onChange={(e) => setZugabe(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch id="nest-auto" checked={autoBreite} onCheckedChange={setAutoBreite} />
          <Label htmlFor="nest-auto">Folienbreite automatisch bestimmen</Label>
        </div>
        {autoBreite && (
          <div className="space-y-1.5">
            <Label htmlFor="nest-kand">Kandidaten-Breiten (mm)</Label>
            <Input id="nest-kand" value={kandidaten} onChange={(e) => setKandidaten(e.target.value)} placeholder="1000, 1370, 1520" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="nest-maxlen">Max. Länge pro Spalte (m)</Label>
          <Input id="nest-maxlen" type="number" inputMode="decimal" value={maxLaengeM} onChange={(e) => setMaxLaengeM(e.target.value)} className="w-32" />
          <p className="text-xs text-muted-foreground">
            Wird eine Spalte länger, bricht das Layout in eine neue Spalte daneben um (damit CorelDRAW die Bahn nicht quetscht). 0 = kein Umbruch.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Optimieren nach</Label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={optimierung === "laenge" ? "default" : "outline"} onClick={() => setOptimierung("laenge")}>
              Minimale Länge
            </Button>
            <Button type="button" size="sm" variant={optimierung === "flaeche" ? "default" : "outline"} onClick={() => setOptimierung("flaeche")}>
              Minimale Fläche
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            „Länge" ist besser bei Einkauf zum Meterpreis mit fester Breite; „Fläche" bei Abrechnung nach m².
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Switch id="nest-stueckeln" checked={stueckeln} onCheckedChange={setStueckeln} />
            <Label htmlFor="nest-stueckeln">Zu große Flächen stückeln</Label>
          </div>
          {stueckeln && (
            <div className="flex gap-2 pl-1">
              <Button type="button" size="sm" variant={stueckelModus === "gleich" ? "default" : "outline"} onClick={() => setStueckelModus("gleich")}>
                Gleiche Teile
              </Button>
              <Button type="button" size="sm" variant={stueckelModus === "rest" ? "default" : "outline"} onClick={() => setStueckelModus("rest")}>
                Folienbreite + Rest
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Flächen, die (auch gedreht) breiter als die Folie sind, werden in passende Streifen zerlegt (Label z. B. „3.2a", „3.2b"). „Gleiche Teile" = gleich breite Streifen; „Folienbreite + Rest" = volle Streifen plus ein Reststück.
          </p>
        </div>

        <Collapsible open={advOpen} onOpenChange={setAdvOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-4 w-4 transition-transform ${advOpen ? "rotate-180" : ""}`} /> Erweitert
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="nest-rand">Rand (mm)</Label>
                <Input id="nest-rand" type="number" value={rand} onChange={(e) => setRand(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="nest-abstand">Abstand (mm)</Label>
                <Input id="nest-abstand" type="number" value={abstand} onChange={(e) => setAbstand(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="nest-reihe">Reihenabstand (mm)</Label>
                <Input id="nest-reihe" type="number" value={reihenAbstand} onChange={(e) => setReihenAbstand(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="nest-schrift">Schriftgröße</Label>
                <Input id="nest-schrift" type="number" value={schriftgroesse} onChange={(e) => setSchriftgroesse(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="nest-zuschlag">Sicherheitszuschlag (%)</Label>
                <Input id="nest-zuschlag" type="number" value={zuschlag} onChange={(e) => setZuschlag(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="nest-spalt">Spaltenabstand (mm)</Label>
                <Input id="nest-spalt" type="number" value={spaltenAbstand} onChange={(e) => setSpaltenAbstand(e.target.value)} /></div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Button onClick={handleCompute} className="w-full sm:w-auto">
          <Scissors className="h-4 w-4 mr-1.5" /> Nesting erstellen
        </Button>

        {result && menge && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
            {zuGross.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <strong>Zu breit für die Folie</strong> (auch gedreht): {zuGross.map((t) => t.label).join(", ")}.
                  Diese sind im SVG rot umrandet — bitte Folienbreite prüfen.
                </div>
              </div>
            )}
            {gestueckeltCount > 0 && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Scissors className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{gestueckeltCount} Streifen aus zu breiten Flächen gestückelt (Label mit Buchstaben-Suffix, z. B. „a", „b").</span>
              </div>
            )}
            {layout && layout.numCols > 1 && (
              <div className="text-sm text-muted-foreground">
                Layout: {layout.numCols} Spalten nebeneinander (längste {f2(Math.max(...layout.spaltenLaengenMm) / 1000)} m) — passt so besser in CorelDRAW.
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Folienbreite</div>
                <div className="font-semibold">{result.folienbreite} mm</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Benötigte Länge</div>
                <div className="font-semibold">{f2(menge.laufmeter)} lfm</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Nettofläche</div>
                <div className="font-semibold">{f2(menge.nettoFlaecheM2)} m²</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Benötigte Folie</div>
                <div className="font-semibold text-primary">{f2(menge.bruttoFlaecheM2)} m²</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Verschnitt</div>
                <div className="font-semibold">{f2(menge.verschnittM2)} m² · {f1(menge.verschnittProzent)} %</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Mehrbedarf ggü. netto</div>
                <div className="font-semibold">+{f1(menge.mehrbedarfProzent)} %</div>
              </div>
            </div>
            <Button variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1.5" /> SVG herunterladen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
