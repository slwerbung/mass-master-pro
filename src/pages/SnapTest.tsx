import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { prepare, detect, type Prepared, type SnapResult } from "@/lib/surfaceSnap";

// Hidden test harness for the semi-automatic surface snap (route /snap-test).
// Load a photo, tap inside a surface, see how well the rectangle snaps to the
// edges. Nothing here touches the real editor — purely for evaluating the CV.

const MAX_DIM = 1100;

export default function SnapTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<ImageData | null>(null);
  const prepRef = useRef<Prepared | null>(null);
  const [result, setResult] = useState<SnapResult | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const [showEdges, setShowEdges] = useState(false);
  const [threshold, setThreshold] = useState(0); // 0 = auto
  const [info, setInfo] = useState<string>("");
  const [hasImage, setHasImage] = useState(false);

  const redraw = useCallback((res: SnapResult | null, tp: { x: number; y: number } | null) => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const prep = prepRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(base, 0, 0);

    if (showEdges && prep) {
      const T = threshold || Math.max(24, Math.min(160, prep.meanMag * 3));
      const overlay = ctx.getImageData(0, 0, prep.w, prep.h);
      const d = overlay.data;
      for (let i = 0; i < prep.mag.length; i++) {
        if (prep.mag[i] > T) { const p = i * 4; d[p] = 255; d[p + 1] = 40; d[p + 2] = 40; d[p + 3] = 255; }
      }
      ctx.putImageData(overlay, 0, 0);
    }

    if (res) {
      const c = res.corners;
      ctx.lineWidth = Math.max(2, canvas.width / 320);
      ctx.strokeStyle = res.approx ? "#f59e0b" : "#22c55e";
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = res.approx ? "#f59e0b" : "#22c55e";
      const r = Math.max(4, canvas.width / 180);
      for (const p of c) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
    }
    if (tp) {
      ctx.fillStyle = "#2563eb";
      const r = Math.max(4, canvas.width / 200);
      ctx.beginPath(); ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [showEdges, threshold]);

  const loadFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = canvasRef.current!;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      const base = ctx.getImageData(0, 0, w, h);
      baseRef.current = base;
      prepRef.current = prepare(base);
      setResult(null); setTap(null); setInfo(""); setHasImage(true);
      redraw(null, null);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const prep = prepRef.current;
    if (!canvas || !prep) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const tp = { x, y };
    setTap(tp);
    const res = detect(prep, tp, threshold ? { threshold } : {});
    setResult(res);
    if (!res) {
      setInfo("Keine Fläche erkannt – näher an eine klare Kante tippen oder Schwelle senken.");
    } else {
      const c = res.corners;
      const dist = (a: typeof c[0], b: typeof c[0]) => Math.hypot(a.x - b.x, a.y - b.y);
      const wpx = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2;
      const hpx = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
      setInfo(`${res.approx ? "≈ grob (nur Box)" : "✓ Kanten gefittet"} · ${Math.round(wpx)}×${Math.round(hpx)} px · Seitenverh. ${(wpx / hpx).toFixed(2)}`);
    }
    redraw(res, tp);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Flächen-Snap · Test (Beta)</h1>
        <p className="text-sm text-muted-foreground">
          Foto laden, dann <b>in eine Fläche tippen</b>. Grün = Kanten sauber gefittet, Gelb = nur grobe Box.
          Rein zum Ausprobieren der Erkennung – der Editor bleibt unberührt.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex">
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.currentTarget.value = ""; }} />
          <Button asChild variant="default"><span>{hasImage ? "Anderes Bild" : "Foto laden"}</span></Button>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showEdges} onChange={(e) => { setShowEdges(e.target.checked); }} />
          Kanten anzeigen
        </label>
        <label className="flex items-center gap-2 text-sm">
          Schwelle: {threshold === 0 ? "auto" : threshold}
          <input type="range" min={0} max={160} step={4} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
      </div>

      {info && <div className="text-sm font-mono rounded bg-muted px-3 py-2">{info}</div>}

      <div className="border rounded-lg overflow-hidden bg-muted/30">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointer}
          className="block w-full h-auto touch-none cursor-crosshair"
          style={{ maxHeight: "72vh", objectFit: "contain", margin: "0 auto" }}
        />
        {!hasImage && (
          <div className="p-10 text-center text-sm text-muted-foreground">Noch kein Bild geladen.</div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Tipp: Wenn es daneben liegt, „Kanten anzeigen" einschalten – dann siehst du, welche Kanten der
        Algorithmus überhaupt sieht. Mit der Schwelle kannst du schwächere/stärkere Kanten ein-/ausblenden.
      </p>
    </div>
  );
}
