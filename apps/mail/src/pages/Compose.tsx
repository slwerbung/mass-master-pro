import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Paperclip, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { invokeFn } from "@/lib/api";
import type { ComposePrefill, ComposeProject, SendAccount } from "@/lib/types";
import { Button, ErrorBox, Input, Select, Spinner, Switch, Textarea } from "@/components/ui";
import { SignaturePreview } from "@/components/SignaturePreview";
import { ProjectSearch } from "@/components/ProjectSearch";
import { errorText } from "@/lib/utils";

type Mode = "reply" | "replyAll" | "forward";
const MODES: Record<Mode, string> = { reply: "Antworten", replyAll: "Allen antworten", forward: "Weiterleiten" };
const MAX_BYTES = 15 * 1024 * 1024;

interface Upload { filename: string; mime: string; size: number; base64: string }

const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function readFile(f: File): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ filename: f.name, mime: f.type || "application/octet-stream", size: f.size, base64: String(r.result).replace(/^data:[^,]*,/, "") });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

/**
 * Mail verfassen: neu, als Antwort oder Weiterleitung. Gesendet wird ueber `email-send` (SMTP des Postfachs),
 * die Kopie landet im Gesendet-Ordner. Die HTML-Signatur des Postfachs wird angehaengt.
 */
export default function Compose() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const replyTo = sp.get("reply") ?? "";
  const mode = (["reply", "replyAll", "forward"].includes(sp.get("mode") ?? "") ? sp.get("mode") : "reply") as Mode;
  const useDraft = sp.get("draft") === "1";

  const accounts = useQuery({ queryKey: ["send-accounts"], queryFn: () => invokeFn<SendAccount[]>("email-send", { action: "accounts" }) });
  const prefill = useQuery({
    queryKey: ["compose-prefill", replyTo, mode],
    queryFn: () => invokeFn<ComposePrefill>("email-send", { action: "prepare", replyTo, mode }),
    enabled: !!replyTo, gcTime: 0, refetchOnWindowFocus: false, retry: false,
  });

  const [accountId, setAccountId] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [withQuote, setWithQuote] = useState(true);
  const [showQuote, setShowQuote] = useState(false);
  const [discardDraft, setDiscardDraft] = useState(true);
  const [fwd, setFwd] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [project, setProject] = useState<ComposeProject | null>(null);
  const [pickProject, setPickProject] = useState(false);

  // Vorbelegung einmal uebernehmen (nie spaeter Eingaben ueberschreiben)
  const applied = useRef(false);
  useEffect(() => {
    const p = prefill.data;
    if (!p || applied.current) return;
    applied.current = true;
    setAccountId(p.accountId);
    setTo(p.to.join(", "));
    setCc(p.cc.join(", "));
    if (p.cc.length) setShowCc(true);
    setSubject(p.subject);
    if (useDraft && p.draftText) setText(p.draftText);
    setFwd(new Set(p.attachments.filter((a) => a.available && !a.ignored).map((a) => a.id)));
    if (p.project) setProject(p.project);
  }, [prefill.data, useDraft]);
  useEffect(() => {
    if (!accountId && !replyTo && accounts.data?.length) setAccountId((accounts.data.find((a) => a.enabled && a.smtp) ?? accounts.data[0]).id);
  }, [accounts.data, accountId, replyTo]);

  const account = accounts.data?.find((a) => a.id === accountId);
  const p = prefill.data;
  const fwdBytes = (p?.attachments ?? []).filter((a) => fwd.has(a.id)).reduce((s, a) => s + a.size, 0);
  const totalBytes = fwdBytes + uploads.reduce((s, u) => s + u.size, 0);
  const tooBig = totalBytes > MAX_BYTES;
  const dirty = useMemo(() => !!(text.trim() || uploads.length), [text, uploads]);

  // KI-Entwurf zur Mail erzeugen (email-draft) und ohne Text-Signatur uebernehmen (die HTML-Signatur haengt beim Senden an)
  const [hint, setHint] = useState("");
  const aiDraft = useMutation({
    mutationFn: async () => {
      await invokeFn("email-draft", { action: "generate", messageId: replyTo, ...(hint.trim() ? { hint: hint.trim() } : {}) });
      const r = await prefill.refetch();
      return r.data?.draftText ?? "";
    },
    onSuccess: (t) => { if (t) setText(t); else toast.error("Kein Entwurf erhalten."); },
    onError: (e) => toast.error(errorText(e)),
  });

  const send = useMutation({
    mutationFn: () => invokeFn<{ messageId: string; warnings: string[] }>("email-send", {
      action: "send", accountId, to, cc, bcc, subject, text, allowEmptySubject: true, // leerer Betreff wurde im Dialog bestaetigt
      ...(replyTo ? { replyTo, mode, withQuote, discardDraft: p?.hasDraft ? discardDraft : false } : {}),
      forwardAttachmentIds: mode === "forward" ? [...fwd] : [],
      uploads: uploads.map(({ filename, mime, base64 }) => ({ filename, mime, base64 })),
      ...(project ? { projectId: project.id } : {}),
    }),
    onSuccess: (r) => {
      toast.success("Gesendet.");
      r.warnings.forEach((w) => toast(w));
      ["messages", "message", "overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      navigate(replyTo ? `/mails/${replyTo}` : "/mails?direction=out");
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const submit = () => {
    if (!to.trim()) return toast.error("Bitte einen Empfänger eintragen.");
    if (!subject.trim() && !confirm("Ohne Betreff senden?")) return;
    if (!confirm(`Mail jetzt an ${to}${cc ? ` (Cc: ${cc})` : ""} senden?`)) return;
    send.mutate();
  };
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      const read = await Promise.all([...files].map(readFile));
      setUploads((u) => [...u, ...read]);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (accounts.isLoading || (replyTo && prefill.isLoading)) return <Spinner />;
  const heading = replyTo ? MODES[mode] : "Neue Mail";
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{heading}</h1>
      </div>
      <ErrorBox error={accounts.error || prefill.error} />

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-[6rem_1fr] sm:items-center">
          <label className="text-sm text-muted-foreground">Von</label>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label || a.address} &lt;{a.address}&gt;{a.smtp ? "" : " – kein SMTP"}</option>)}
          </Select>
          <label className="text-sm text-muted-foreground">An</label>
          <div className="flex gap-2">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@firma.de, weitere mit Komma" autoFocus={!replyTo || mode === "forward"} />
            {!showCc && <Button variant="ghost" size="sm" onClick={() => setShowCc(true)}>Cc/Bcc</Button>}
          </div>
          {showCc && (
            <>
              <label className="text-sm text-muted-foreground">Cc</label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} />
              <label className="text-sm text-muted-foreground">Bcc</label>
              <Input value={bcc} onChange={(e) => setBcc(e.target.value)} />
            </>
          )}
          <label className="text-sm text-muted-foreground">Betreff</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        {account && !account.smtp && <ErrorBox error="Für dieses Postfach ist kein SMTP-Server hinterlegt (Einstellungen → Postfächer)." />}

        <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-sans" autoFocus={!!replyTo && mode !== "forward"}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }} />
        {(text.match(/\[\[[^\]]+\]\]/g) ?? []).length > 0 && <p className="text-xs text-amber-800">Platzhalter in [[ ]] müssen noch ausgefüllt werden.</p>}
        {replyTo && mode !== "forward" && (
          <div className="flex flex-wrap items-center gap-2">
            {p?.draftText && !useDraft && !text.trim() && (
              <Button variant="outline" size="sm" onClick={() => setText(p.draftText ?? "")}>KI-Entwurf übernehmen</Button>
            )}
            <Input className="w-64" placeholder="Hinweis an die KI, z. B. „kürzer, per Du“" value={hint} onChange={(e) => setHint(e.target.value)} />
            <Button variant="outline" size="sm" disabled={aiDraft.isPending}
              onClick={() => { if (!text.trim() || confirm("Den bisherigen Text durch einen neuen KI-Entwurf ersetzen?")) aiDraft.mutate(); }}>
              {aiDraft.isPending ? <Spinner /> : p?.draftText ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {p?.draftText ? " Neuen KI-Entwurf erzeugen" : " KI-Entwurf erzeugen"}
            </Button>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Signatur ({account?.label || account?.address || "–"})</div>
          {account?.signatureHtml ? <SignaturePreview html={account.signatureHtml} />
            : <p className="text-xs text-muted-foreground">Keine HTML-Signatur hinterlegt (Einstellungen → Postfächer).</p>}
        </div>

        {p && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-2">
            <div className="flex flex-wrap items-center gap-3">
              <Switch checked={withQuote} onChange={setWithQuote} label={mode === "forward" ? "Weitergeleitete Mail anhängen" : "Originalmail zitieren"} />
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowQuote(!showQuote)}>{showQuote ? "ausblenden" : "ansehen"}</button>
            </div>
            {showQuote && <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{p.quoteText}</pre>}
          </div>
        )}

        <div className="space-y-2">
          {mode === "forward" && (p?.attachments.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Anhänge der Originalmail</div>
              {p!.attachments.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={!a.available} checked={fwd.has(a.id)}
                    onChange={() => setFwd((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} />
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> {a.filename}
                  <span className="text-xs text-muted-foreground">{fmtSize(a.size)}{a.available ? "" : " – nicht mehr gespeichert"}</span>
                </label>
              ))}
            </div>
          )}
          {uploads.map((u, i) => (
            <div key={`${u.filename}-${i}`} className="flex items-center gap-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> {u.filename} <span className="text-xs text-muted-foreground">{fmtSize(u.size)}</span>
              <button type="button" aria-label="Entfernen" onClick={() => setUploads((x) => x.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-primary hover:underline">
            <Paperclip className="h-3.5 w-3.5" /> Datei anhängen
            <input type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {tooBig && <p className="text-xs text-red-700">Anhänge zusammen {fmtSize(totalBytes)} – höchstens 15 MB.</p>}
        </div>

        <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            {project
              ? <span>Ins HERO-Logbuch von <b>{project.nr ?? `Projekt ${project.id}`}</b>{project.name ? ` · ${project.name}` : ""}</span>
              : <span className="text-muted-foreground">Kein Projekt – nur im Logbuch, wenn der Assistent es sicher erkennt (Thread, Projektnummer)</span>}
            <Button variant="ghost" size="sm" onClick={() => setPickProject(!pickProject)}>{project ? "ändern" : "Projekt wählen"}</Button>
            {project && <Button variant="ghost" size="sm" onClick={() => setProject(null)}>entfernen</Button>}
          </div>
          {pickProject && (
            <ProjectSearch selectedId={project?.id} onPick={(h) => { setProject({ id: h.id, nr: h.nr, name: h.name }); setPickProject(false); }} />
          )}
        </div>

        {p?.hasDraft && (
          <Switch checked={discardDraft} onChange={setDiscardDraft} label="KI-Entwurf im Ordner „Entwürfe“ danach in den Papierkorb" />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button onClick={submit} disabled={send.isPending || !accountId || !account?.smtp || tooBig}>
            {send.isPending ? <Spinner /> : <Send className="h-4 w-4" />} Senden
          </Button>
          <Button variant="outline" onClick={() => { if (!dirty || confirm("Mail verwerfen?")) navigate(-1); }}>Verwerfen</Button>
          <span className="text-xs text-muted-foreground">Strg+Enter sendet. Die Kopie liegt danach im Ordner „Gesendet“{account?.sentFolder ? ` (${account.sentFolder})` : ""}.</span>
        </div>
      </div>
    </div>
  );
}
