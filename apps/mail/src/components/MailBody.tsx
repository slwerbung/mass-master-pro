import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, RefreshCw } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";

interface BodyResult { html: string | null; kind: "html" | "text" | "missing"; text?: string | null; source: string }

/** Externe Bilder (Tracking-Pixel) erst nach Klick laden – wie in Thunderbird. */
const hasRemoteImages = (html: string) => /<img[^>]+src\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);

function srcDoc(html: string, remote: boolean): string {
  // Kein Skript, keine Formulare; Bilder nur eingebettet (data:) – externe erst nach Freigabe.
  const csp = `default-src 'none'; style-src 'unsafe-inline'${remote ? " https: http:" : ""}; img-src data:${remote ? " https: http:" : ""}; font-src data:${remote ? " https:" : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">` +
    `<style>html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.45;overflow-wrap:anywhere}` +
    `body{padding:4px 2px}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:3px solid #ddd;color:#555}</style></head><body>${html}</body></html>`;
}

/**
 * Die Mail so, wie sie beim Kunden aussieht: HTML aus dem Postfach in einem abgeschotteten iframe
 * (sandbox ohne Skripte, eigene CSP). Die Hoehe passt sich dem Inhalt an.
 */
export function MailBody({ messageId, fallbackText }: { messageId: string; fallbackText: string | null }) {
  const q = useQuery({
    queryKey: ["mail-body", messageId],
    queryFn: () => invokeFn<BodyResult>("email-mailbox", { action: "body", id: messageId }),
    staleTime: Infinity,
    retry: false,
  });
  const [remote, setRemote] = useState(false);
  const [height, setHeight] = useState(200);
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => { setRemote(false); }, [messageId]);

  const measure = () => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 80), 20000));
    // Spaeter geladene Bilder aendern die Hoehe noch.
    doc.querySelectorAll("img").forEach((img) => { if (!img.complete) img.addEventListener("load", measure, { once: true }); });
  };

  if (q.isLoading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner /> Mail wird aus dem Postfach geladen …</div>;
  const r = q.data;
  if (q.error || !r || !r.html) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {q.error ? `Original konnte nicht geladen werden (${(q.error as Error).message}). ` : "Die Mail liegt nicht mehr im Postfach. "}Gezeigt wird der gespeicherte Text.
        </p>
        <div className="whitespace-pre-wrap text-sm">{fallbackText ?? r?.text ?? "(Text nach der Aufbewahrungsfrist entfernt)"}</div>
      </div>
    );
  }
  const remoteImgs = hasRemoteImages(r.html);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {remoteImgs && !remote && (
          <Button size="sm" variant="outline" className="h-7" onClick={() => setRemote(true)}><ImageOff className="h-3.5 w-3.5" /> Externe Bilder laden</Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-muted-foreground" onClick={() => invokeFn("email-mailbox", { action: "body", id: messageId, refresh: true }).then(() => q.refetch())}>
          <RefreshCw className="h-3 w-3" /> Neu aus dem Postfach laden
        </Button>
      </div>
      <iframe
        ref={ref} title="Mail" className="w-full rounded-md border bg-white" style={{ height }}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc(r.html, remote)} onLoad={measure}
      />
    </div>
  );
}
