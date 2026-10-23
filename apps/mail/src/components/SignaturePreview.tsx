import { useRef, useState } from "react";

/** HTML-Signatur so, wie sie beim Empfaenger aussieht – im abgeschotteten iframe (keine Skripte, eigene CSP). */
export function SignaturePreview({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  const measure = () => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    const h = () => setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 30) + 4, 600));
    h();
    setTimeout(h, 100);
    doc.querySelectorAll("img").forEach((img) => { if (!img.complete) img.addEventListener("load", measure, { once: true }); });
  };
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data: https:";
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">` +
    `<style>html,body{margin:0;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px}body{padding:6px 8px;display:flow-root}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref} title="Signatur" sandbox="allow-same-origin allow-popups" srcDoc={doc} onLoad={measure}
      className="w-full rounded-md border bg-white" style={{ height }}
    />
  );
}
