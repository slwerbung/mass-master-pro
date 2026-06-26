import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileUp, CheckCircle2, Loader2, X, FileText, Image } from "lucide-react";
import { toast } from "sonner";

// Public page: a customer uploads layout file(s) for the vehicle project they
// just created. Multiple files of different types are supported. An optional
// comment is stored alongside the files and mirrored to the HERO logbook.
// Reached from the vehicle-inquiry success screen via
// /layout-upload?project=<id>&hero=<heroId>.

type UploadFile = { dataUrl: string; name: string; size: number; mimeType: string };

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.svg,.gif,.ai,.eps";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

export default function LayoutUpload() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project") || "";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [comment, setComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = "";

    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`„${f.name}" ist zu groß (max. 25 MB)`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Lesefehler"));
        r.readAsDataURL(f);
      });
      setFiles((prev) => [...prev, { dataUrl, name: f.name, size: f.size, mimeType: f.type }]);
    }
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const submit = async () => {
    if (!projectId) { toast.error("Kein Projekt angegeben"); return; }
    if (files.length === 0) { toast.error("Bitte mindestens eine Datei auswählen"); return; }
    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-layout", {
        body: {
          projectId,
          files: files.map((f) => ({ dataUrl: f.dataUrl, filename: f.name })),
          comment: comment.trim() || undefined,
        },
      });
      if (error) { toast.error("Upload fehlgeschlagen: " + error.message); return; }
      if (!data?.ok) { toast.error(data?.error || "Upload fehlgeschlagen"); return; }
      if (data.heroWarning) toast.warning(data.heroWarning);
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
            Laden Sie Ihr fertiges Design hoch. Mehrere Dateien sind möglich.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ihre Dateien</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-32 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            >
              <FileUp className="h-8 w-8 mb-1" />
              <span className="font-medium text-sm">Dateien hinzufügen</span>
              <span className="text-xs mt-1">PDF, JPG, PNG, SVG u.a. – max. 25 MB pro Datei</span>
            </button>

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40">
                    {isImageMime(f.mimeType) ? (
                      <Image className="h-8 w-8 text-primary shrink-0" />
                    ) : (
                      <FileText className="h-8 w-8 text-primary shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{f.name}</div>
                      <div className="text-xs text-muted-foreground">{formatSize(f.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="p-1.5 rounded-full hover:bg-background"
                      aria-label="Entfernen"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground text-right">
                  {files.length} Datei{files.length !== 1 ? "en" : ""} · {formatSize(totalSize)} gesamt
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={onPick}
            />

            <div className="space-y-1.5">
              <Label htmlFor="layout-comment">Kommentar (optional)</Label>
              <Textarea
                id="layout-comment"
                placeholder="z.B. Bitte auf Druckfarben und Randabfall achten…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
            </div>

            <Button className="w-full" disabled={files.length === 0 || uploading} onClick={submit}>
              {uploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Wird hochgeladen…</>
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
