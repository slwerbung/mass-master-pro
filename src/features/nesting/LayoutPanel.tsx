import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LayoutGrid, Download, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { downloadBlob } from "@/lib/exportUtils";
import type { Teil } from "./types";
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions, layoutFlow, buildLayoutSvg } from "./layout";
import { parseText, teileZuText } from "./parse";

interface LayoutPanelProps {
  initialTeile: Teil[];
  projektnummer: string;
}

const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export default function LayoutPanel({ initialTeile, projektnummer }: LayoutPanelProps) {
  const [text, setText] = useState(() => teileZuText(initialTeile));
  const [abstand, setAbstand] = useState(String(DEFAULT_LAYOUT_OPTIONS.abstand));
  const [zeilenAbstand, setZeilenAbstand] = useState(String(DEFAULT_LAYOUT_OPTIONS.zeilenAbstand));
  const [maxBreite, setMaxBreite] = useState(String(DEFAULT_LAYOUT_OPTIONS.maxZeilenBreiteMm));
  const [zugabe, setZugabe] = useState("0");
  const [advOpen, setAdvOpen] = useState(false);
  const [rand, setRand] = useState(String(DEFAULT_LAYOUT_OPTIONS.rand));
  const [schriftgroesse, setSchriftgroesse] = useState(String(DEFAULT_LAYOUT_OPTIONS.schriftgroesse));
  const [result, setResult] = useState<ReturnType<typeof layoutFlow> | null>(null);
  const [usedOpt, setUsedOpt] = useState<LayoutOptions | null>(null);

  const num = (s: string, fb: number) => {
    const n = parseFloat(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const partCount = useMemo(() => parseText(text).length, [text]);

  const buildOptions = (): LayoutOptions => ({
    ...DEFAULT_LAYOUT_OPTIONS,
    abstand: Math.max(0, num(abstand, DEFAULT_LAYOUT_OPTIONS.abstand)),
    zeilenAbstand: Math.max(0, num(zeilenAbstand, DEFAULT_LAYOUT_OPTIONS.zeilenAbstand)),
    maxZeilenBreiteMm: Math.max(0, num(maxBreite, DEFAULT_LAYOUT_OPTIONS.maxZeilenBreiteMm)),
    zugabe: Math.max(0, num(zugabe, 0)),
    rand: Math.max(0, num(rand, DEFAULT_LAYOUT_OPTIONS.rand)),
    schriftgroesse: Math.max(1, num(schriftgroesse, DEFAULT_LAYOUT_OPTIONS.schriftgroesse)),
    projektnummer,
  });

  const handleCompute = () => {
    const teile = parseText(text);
    if (teile.length === 0) {
      toast.error("Keine gültigen Maße gefunden. Format: „F1: 500 x 300 mm“");
      return;
    }
    const opt = buildOptions();
    setUsedOpt(opt);
    setResult(layoutFlow(teile, opt));
  };

  const handleDownload = async () => {
    const teile = parseText(text);
    if (teile.length === 0 || !usedOpt) return;
    const svg = buildLayoutSvg(teile, usedOpt);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const safeNr = (projektnummer || "Projekt").replace(/[^A-Za-z0-9-]/g, "_");
    const ok = await downloadBlob(blob, `Layout_${safeNr}_${stamp}.svg`);
    if (ok) toast.success("Layout-SVG gespeichert");
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-primary" /> Layout Export
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Ordnet die Flächen in ihrer Reihenfolge nebeneinander an (ohne Nesting/Drehen) und erzeugt ein SVG.
          Abstand und Zeilenumbruch sind frei wählbar.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="lay-text">Maße (aus dem Flächenaufmaß, editierbar)</Label>
          <Textarea id="lay-text" className="min-h-[120px] font-mono text-sm" value={text}
            onChange={(e) => setText(e.target.value)} placeholder={"F1: 500 x 300 mm\nF2: 1000 x 500 mm"} />
          <p className="text-xs text-muted-foreground">{partCount} Teil(e) erkannt.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lay-abstand">Abstand zwischen Flächen (mm)</Label>
            <Input id="lay-abstand" type="number" inputMode="decimal" value={abstand} onChange={(e) => setAbstand(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lay-zugabe">Zugabe ringsum (mm)</Label>
            <Input id="lay-zugabe" type="number" inputMode="decimal" value={zugabe} onChange={(e) => setZugabe(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lay-maxbreite">Neue Zeile ab Breite (mm)</Label>
            <Input id="lay-maxbreite" type="number" inputMode="decimal" value={maxBreite} onChange={(e) => setMaxBreite(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lay-zeile">Zeilenabstand (mm)</Label>
            <Input id="lay-zeile" type="number" inputMode="decimal" value={zeilenAbstand} onChange={(e) => setZeilenAbstand(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">„Neue Zeile ab Breite" = 0 bedeutet eine durchgehende Zeile ohne Umbruch.</p>

        <Collapsible open={advOpen} onOpenChange={setAdvOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-4 w-4 transition-transform ${advOpen ? "rotate-180" : ""}`} /> Erweitert
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="lay-rand">Rand (mm)</Label>
                <Input id="lay-rand" type="number" value={rand} onChange={(e) => setRand(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="lay-schrift">Schriftgröße</Label>
                <Input id="lay-schrift" type="number" value={schriftgroesse} onChange={(e) => setSchriftgroesse(e.target.value)} /></div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Button onClick={handleCompute} className="w-full sm:w-auto">
          <LayoutGrid className="h-4 w-4 mr-1.5" /> Layout erstellen
        </Button>

        {result && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Flächen</div><div className="font-semibold">{result.pieces.length}</div></div>
              <div><div className="text-xs text-muted-foreground">Zeilen</div><div className="font-semibold">{result.zeilen}</div></div>
              <div><div className="text-xs text-muted-foreground">Gesamtmaß</div><div className="font-semibold">{f2(result.breiteMm / 1000)} × {f2(result.hoeheMm / 1000)} m</div></div>
            </div>
            <Button variant="outline" onClick={handleDownload}><Download className="h-4 w-4 mr-1.5" /> Layout-SVG herunterladen</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
