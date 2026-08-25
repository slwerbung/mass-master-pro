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
import { DEFAULT_OPTIONS, nesting, nestingMulti, type NestGruppe } from "./nesting";
import { berechneFolienMenge } from "./folienmenge";
import { parseText, teileZuText } from "./parse";
import { buildSvg, computeLayout } from "./svg";

interface NestingPanelProps {
  initialTeile: Teil[];
  projektnummer: string;
}

const f2 = (n: number) => n.toFixed(2).replace(".", ",");
const f1 = (n: number) => n.toFixed(1).replace(".", ",");

export default function NestingPanel({ initialTeile, projektnummer }: NestingPanelProps) {
  const [text, setText] = useState(() => teileZuText(initialTeile));
  const [mehrbreiten, setMehrbreiten] = useState(false);
  const [autoBreite, setAutoBreite] = useState(DEFAULT_OPTIONS.autoBreite);
  const [folienbreite, setFolienbreite] = useState(String(DEFAULT_OPTIONS.folienbreite));
  const [kandidaten, setKandidaten] = useState(DEFAULT_OPTIONS.breitenKandidaten.join(", "));
  const [zugabe, setZugabe] = useState("0");
  const [optimierung, setOptimierung] = useState<NestingOptions["optimierung"]>(DEFAULT_OPTIONS.optimierung);
  const [stueckeln, setStueckeln] = useState(DEFAULT_OPTIONS.stueckeln);
  const [stueckelModus, setStueckelModus] = useState<NestingOptions["stueckelModus"]>(DEFAULT_OPTIONS.stueckelModus);
  const [maxLaengeM, setMaxLaengeM] = useState(String(DEFAULT_OPTIONS.maxLaengeMm / 1000));
  const [spaltenAbstand, setSpaltenAbstand] = useState(String(DEFAULT_OPTIONS.spaltenAbstand));
  const [zuschlag, setZuschlag] = useState("0");
  const [advOpen, setAdvOpen] = useState(false);
  const [rand, setRand] = useState(String(DEFAULT_OPTIONS.rand));
  const [abstand, setAbstand] = useState(String(DEFAULT_OPTIONS.abstand));
  const [reihenAbstand, setReihenAbstand] = useState(String(DEFAULT_OPTIONS.reihenAbstand));
  const [schriftgroesse, setSchriftgroesse] = useState(String(DEFAULT_OPTIONS.schriftgroesse));

  const [result, setResult] = useState<PackResult | null>(null);
  const [menge, setMenge] = useState<FolienMenge | null>(null);
  const [groups, setGroups] = useState<NestGruppe[] | null>(null);
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
    const mengen = { sicherheitszuschlag: Math.max(0, num(zuschlag, 0)) / 100 };
    setUsedOpt(opt);
    if (mehrbreiten) {
      setGroups(nestingMulti(teile, opt));
      setResult(null);
      setMenge(null);
    } else {
      const r = nesting(teile, opt);
      setResult(r);
      setMenge(berechneFolienMenge(teile, r, opt, mengen));
      setGroups(null);
      if (autoBreite) setFolienbreite(String(r.folienbreite));
    }
  };

  const svgDownload = async (res: PackResult) => {
    if (!usedOpt) return;
    const svg = buildSvg(res, usedOpt);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const safeNr = (projektnummer || "Projekt").replace(/[^A-Za-z0-9-]/g, "_");
    const ok = await downloadBlob(blob, `Flaechenzuschnitt_${safeNr}_${res.folienbreite}mm_${stamp}.svg`);
    if (ok) toast.success("SVG gespeichert");
  };

  const mengeFor = (g: NestGruppe): FolienMenge =>
    berechneFolienMenge(g.teile, g.result, usedOpt!, { sicherheitszuschlag: Math.max(0, num(zuschlag, 0)) / 100 });

  const groupMengen = groups && usedOpt ? groups.map((g) => ({ g, m: mengeFor(g) })) : null;
  const totalNetto = groupMengen?.reduce((s, x) => s + x.m.nettoFlaecheM2, 0) ?? 0;
  const totalBrutto = groupMengen?.reduce((s, x) => s + x.m.bruttoFlaecheM2, 0) ?? 0;

  const zuGross = result?.teile.filter((t) => t.zuGross) ?? [];
  const gestueckeltCount = result?.teile.filter((t) => t.gestueckelt).length ?? 0;
  const layout = result && usedOpt ? computeLayout(result, usedOpt) : null;

  const numField = (id: string, label: string, val: string, set: (v: string) => void, disabled = false, className = "") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" value={val} onChange={(e) => set(e.target.value)} disabled={disabled} className={className} />
    </div>
  );

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
          <Textarea id="nest-text" className="min-h-[120px] font-mono text-sm" value={text}
            onChange={(e) => setText(e.target.value)} placeholder={"F1: 500 x 300 mm\nF2: 1000 x 500 mm"} />
          <p className="text-xs text-muted-foreground">{partCount} Teil(e) erkannt.</p>
        </div>

        <div className="flex items-center gap-3">
          <Switch id="nest-multi" checked={mehrbreiten} onCheckedChange={setMehrbreiten} />
          <Label htmlFor="nest-multi">Mehrere Folienbreiten (mitdenken)</Label>
        </div>

        {mehrbreiten ? (
          <div className="space-y-1.5">
            <Label htmlFor="nest-kand-m">Verfügbare Folienbreiten (mm)</Label>
            <Input id="nest-kand-m" value={kandidaten} onChange={(e) => setKandidaten(e.target.value)} placeholder="1000, 1200, 1520" />
            <p className="text-xs text-muted-foreground">
              Jede Fläche kommt auf die Breite mit dem geringsten Breiten-Verschnitt. Pro genutzter Breite entsteht ein eigenes SVG.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {numField("nest-breite", "Folienbreite (mm)", folienbreite, setFolienbreite, autoBreite)}
              {numField("nest-zugabe", "Zugabe ringsum (mm)", zugabe, setZugabe)}
            </div>
            <div className="flex items-center gap-3">
              <Switch id="nest-auto" checked={autoBreite} onCheckedChange={setAutoBreite} />
              <Label htmlFor="nest-auto">Folienbreite automatisch bestimmen</Label>
            </div>
            {autoBreite && (
              <div className="space-y-1.5">
                <Label htmlFor="nest-kand">Kandidaten-Breiten (mm)</Label>
                <Input id="nest-kand" value={kandidaten} onChange={(e) => setKandidaten(e.target.value)} placeholder="1000, 1200, 1520" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Optimieren nach</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={optimierung === "laenge" ? "default" : "outline"} onClick={() => setOptimierung("laenge")}>Minimale Länge</Button>
                <Button type="button" size="sm" variant={optimierung === "flaeche" ? "default" : "outline"} onClick={() => setOptimierung("flaeche")}>Minimale Fläche</Button>
              </div>
            </div>
          </>
        )}

        {mehrbreiten && numField("nest-zugabe-m", "Zugabe ringsum (mm)", zugabe, setZugabe, false, "w-32")}

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Switch id="nest-stueckeln" checked={stueckeln} onCheckedChange={setStueckeln} />
            <Label htmlFor="nest-stueckeln">Zu große Flächen stückeln</Label>
          </div>
          {stueckeln && (
            <div className="flex gap-2 pl-1">
              <Button type="button" size="sm" variant={stueckelModus === "gleich" ? "default" : "outline"} onClick={() => setStueckelModus("gleich")}>Gleiche Teile</Button>
              <Button type="button" size="sm" variant={stueckelModus === "rest" ? "default" : "outline"} onClick={() => setStueckelModus("rest")}>Folienbreite + Rest</Button>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nest-maxlen">Max. Länge pro Spalte (m)</Label>
          <Input id="nest-maxlen" type="number" inputMode="decimal" value={maxLaengeM} onChange={(e) => setMaxLaengeM(e.target.value)} className="w-32" />
          <p className="text-xs text-muted-foreground">Wird eine Spalte länger, bricht das Layout in eine neue Spalte daneben um. 0 = kein Umbruch.</p>
        </div>

        <Collapsible open={advOpen} onOpenChange={setAdvOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-4 w-4 transition-transform ${advOpen ? "rotate-180" : ""}`} /> Erweitert
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="grid grid-cols-2 gap-3">
              {numField("nest-rand", "Rand (mm)", rand, setRand)}
              {numField("nest-abstand", "Abstand (mm)", abstand, setAbstand)}
              {numField("nest-reihe", "Reihenabstand (mm)", reihenAbstand, setReihenAbstand)}
              {numField("nest-schrift", "Schriftgröße", schriftgroesse, setSchriftgroesse)}
              {numField("nest-zuschlag", "Sicherheitszuschlag (%)", zuschlag, setZuschlag)}
              {numField("nest-spalt", "Spaltenabstand (mm)", spaltenAbstand, setSpaltenAbstand)}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Button onClick={handleCompute} className="w-full sm:w-auto">
          <Scissors className="h-4 w-4 mr-1.5" /> Nesting erstellen
        </Button>

        {/* Single-width result */}
        {result && menge && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
            {zuGross.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div><strong>Zu breit für die Folie</strong> (auch gedreht): {zuGross.map((t) => t.label).join(", ")}. Rot umrandet — Folienbreite prüfen.</div>
              </div>
            )}
            {gestueckeltCount > 0 && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Scissors className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{gestueckeltCount} Streifen aus zu breiten Flächen gestückelt (Suffix „a", „b").</span>
              </div>
            )}
            {layout && layout.numCols > 1 && (
              <div className="text-sm text-muted-foreground">
                Layout: {layout.numCols} Spalten nebeneinander (längste {f2(Math.max(...layout.spaltenLaengenMm) / 1000)} m).
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Folienbreite</div><div className="font-semibold">{result.folienbreite} mm</div></div>
              <div><div className="text-xs text-muted-foreground">Benötigte Länge</div><div className="font-semibold">{f2(menge.laufmeter)} lfm</div></div>
              <div><div className="text-xs text-muted-foreground">Nettofläche</div><div className="font-semibold">{f2(menge.nettoFlaecheM2)} m²</div></div>
              <div><div className="text-xs text-muted-foreground">Benötigte Folie</div><div className="font-semibold text-primary">{f2(menge.bruttoFlaecheM2)} m²</div></div>
              <div><div className="text-xs text-muted-foreground">Verschnitt</div><div className="font-semibold">{f2(menge.verschnittM2)} m² · {f1(menge.verschnittProzent)} %</div></div>
              <div><div className="text-xs text-muted-foreground">Mehrbedarf ggü. netto</div><div className="font-semibold">+{f1(menge.mehrbedarfProzent)} %</div></div>
            </div>
            <Button variant="outline" onClick={() => svgDownload(result)}><Download className="h-4 w-4 mr-1.5" /> SVG herunterladen</Button>
          </div>
        )}

        {/* Multi-width result */}
        {groupMengen && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <div className="font-medium mb-1">Aufteilung auf {groupMengen.length} Folienbreite(n)</div>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Netto gesamt: </span><span className="font-semibold">{f2(totalNetto)} m²</span></div>
                <div><span className="text-muted-foreground">Folie gesamt: </span><span className="font-semibold text-primary">{f2(totalBrutto)} m²</span></div>
                <div className="col-span-2"><span className="text-muted-foreground">Verschnitt gesamt: </span><span className="font-semibold">{f2(totalBrutto - totalNetto)} m² · {f1(totalBrutto > 0 ? (totalBrutto - totalNetto) / totalBrutto * 100 : 0)} %</span></div>
              </div>
            </div>
            {groupMengen.map(({ g, m }) => {
              const gzu = g.result.teile.filter((t) => t.zuGross);
              return (
                <div key={g.folienbreite} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-semibold">{g.folienbreite} mm · {g.teile.length} Fläche(n)</div>
                    <Button size="sm" variant="outline" onClick={() => svgDownload(g.result)}><Download className="h-4 w-4 mr-1.5" /> SVG {g.folienbreite} mm</Button>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {f2(m.laufmeter)} lfm · Folie {f2(m.bruttoFlaecheM2)} m² · Verschnitt {f1(m.verschnittProzent)} %
                  </div>
                  {gzu.length > 0 && (
                    <div className="text-xs text-amber-700 dark:text-amber-400">Zu breit (rot im SVG): {gzu.map((t) => t.label).join(", ")}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
