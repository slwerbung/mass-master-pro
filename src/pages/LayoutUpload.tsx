import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUp, CheckCircle2, Loader2, X, FileText } from "lucide-react";
import { toast } from "sonner";

// Public page: a customer uploads an existing layout PDF for the vehicle
// project they just created. Reached from the vehicle-inquiry success
// screen via /layout-upload?project=<id>&hero=<heroId>. The heavy lifting
// (storage + HERO mirror) happens in the submit-layout edge function so
// this page stays a thin client.
export default function LayoutUpload() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project") || "";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ dataUrl: string; name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  const sizeLabel = useMemo(() => {
    if (!file) return "";
    const mb = file.size / (1024 * 1024);
    return mb < 1 ? `${Math.round(file.size / 1024)} KB` : `${mb.toFixed(1)} MB`;
  }, [file]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") {
      toast.error("Bitte eine PDF-Datei auswählen");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.error("Datei zu groß (max. 25 MB)");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("Lesefehler"));
      r.readAsDataURL(f);
    });
    setFile({ dataUrl, name: f.name, size: f.size });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    if (!projectId) {
      toast.error("Kein Projekt angegeben");
      return;
    }
    if (!file) {
      toast.error("Bitte erst eine Datei auswählen");
      return;
    }
    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-layout", {
        body: { projectId, fileDataUrl: file.dataUrl, filename: file.name },
      });
      if (error) {
        toast.error("Upload fehlgeschlagen: " + error.message);
        return;
      }
      if (!data?.ok) {
        toast.error(data?.error || "Upload fehlgeschlagen");
        return;
      }
      if (data.hero && data.hero.ok === false) {
        // Stored locally but HERO mirror failed - tell the user the file
        // is safe but flag the partial failure.
        toast.warning("Layout gespeichert, HERO-Upload fehlgeschlagen");
      }
      setDone(true);
    } catch (e: any) {
      toast.error("Fehler: " + (e.message || String(e)));
    } finally {
      setUploading(false);
    }
  };

  if (!projectId) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <h2 className="text-xl font-bold">Kein Projekt angegeben</h2>
            <p className="text-muted-foreground">Dieser Link ist ungültig oder unvollständig.</p>
            <Button onClick={() => navigate("/")}>Zur Startseite</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
            <h2 className="text-2xl font-bold">Layout hochgeladen</h2>
            <p className="text-muted-foreground">
              Vielen Dank! Ihr Layout wurde übermittelt und Ihrem Projekt zugeordnet.
              Wir melden uns zur weiteren Abstimmung.
            </p>
            <Button className="w-full" onClick={() => navigate("/")}>Zur Startseite</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Layout hochladen</h1>
          <p className="text-muted-foreground">
            Laden Sie Ihr fertiges Design als PDF hoch. Wir ordnen es Ihrem Projekt zu.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ihr Layout (PDF)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-40 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-colors"
              >
                <FileUp className="h-10 w-10 mb-2" />
                <span className="font-medium">PDF auswählen</span>
                <span className="text-xs mt-1">max. 25 MB</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/40">
                <FileText className="h-10 w-10 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{sizeLabel}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="p-1.5 rounded-full hover:bg-background"
                  aria-label="Entfernen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={onPick}
            />

            <Button className="w-full" disabled={!file || uploading} onClick={submit}>
              {uploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Wird hochgeladen...</>
              ) : (
                <>Layout absenden</>
              )}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
              Abbrechen
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
