import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Send } from "lucide-react";
import { api } from "@/lib/api";
import type { Suggestion } from "@/lib/suggestions";
import { Badge, Button, ErrorBox, Field, Input, Select, Spinner } from "@/components/ui";
import { Buttons, ExistingCustomerChoice, quoted, SuggestionCard, useDecide, type ExistingCustomer } from "@/components/SuggestionParts";
import { cn, formatDate } from "@/lib/utils";

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

interface Position {
  sourceDocId: number; sourceDocNr: string; uid: string; type: string; name: string; description: string; nr: string | null;
  unit: string; quantity: number; sourceQuantity: number; netPrice: number; vat: number; note: string | null; include: boolean;
}

/**
 * Bestellung -> Projekt + Auftragsbestätigung. Positionen, Einheiten und Preise stammen aus einer früheren AB
 * bzw. dem Angebot in HERO; hier lassen sich nur Auswahl und Menge ändern. Angelegt wird ein ENTWURF.
 */
export function ConfirmationCard({ s, embedded }: { s: Suggestion; embedded?: boolean }) {
  const decide = useDecide(s, (r) => `AB-Entwurf in HERO angelegt${r.projectNr ? ` (${r.projectNr})` : ""} – bitte dort prüfen und abschließen.`);
  const p = s.payload;
  const [positions, setPositions] = useState<Position[]>(p.positions ?? []);
  const [name, setName] = useState<string>(p.project?.name ?? "");
  const [contact, setContact] = useState<Record<string, string | null>>(p.contact ?? {});
  const [toStepId, setToStepId] = useState<number | "">(p.toStepId ?? "");
  const upd = (i: number, x: Partial<Position>) => setPositions(positions.map((y, j) => (j === i ? { ...y, ...x } : y)));
  const sum = positions.filter((x) => x.include).reduce((n, x) => n + x.quantity * x.netPrice, 0);
  const sources = (p.sources ?? []) as { id: number; nr: string; kind: string; date: string | null; projectNr: string | null }[];
  const steps = (p.stepOptions ?? []) as { stepId: number; label: string }[];
  const open = (p.openPoints ?? []) as string[];
  const newProject = !p.projectId;
  const existing = (p.existingCustomer ?? null) as ExistingCustomer | null;
  const [useExisting, setUseExisting] = useState(!!existing);
  const fromExisting = newProject && !!existing && useExisting;
  const included = positions.filter((x) => x.include).length;

  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={`${!newProject ? (p.projectNr ?? `#${p.projectId}`) : fromExisting ? `neues Projekt bei ${existing!.name}` : "neues Projekt + neuer Kontakt"} · ${included} Position(en)${included ? ` · ${euro(sum)} netto` : ""}`}
      actions={
        <div className="space-y-2">
          <Buttons
            s={s} busy={decide.isPending}
            acceptLabel={!newProject ? `AB-Entwurf in ${p.projectNr ?? `#${p.projectId}`} anlegen`
              : fromExisting ? `Neues Projekt ${quoted(name)} beim bestehenden Kunden ${existing!.name} + AB-Entwurf anlegen`
              : `Neuen Kontakt, Projekt ${quoted(name)} und AB-Entwurf in HERO anlegen`}
            onAccept={() => decide.mutate({ decision: "accept", edits: { positions, toStepId: toStepId || null, ...(newProject ? { project: { ...p.project, name }, contact, useExisting: fromExisting } : {}) } })}
            onReject={(reason) => decide.mutate({ decision: "reject", edits: { reason } })}
          />
          <p className="text-xs text-muted-foreground">Es wird nichts versendet. Die AB entsteht als Entwurf; danach erscheint hier „Prüfen &amp; versenden“.</p>
        </div>
      }
    >
        {newProject ? (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Neues Projekt anlegen</p>
            {existing && <ExistingCustomerChoice customer={existing} useExisting={useExisting} onChange={setUseExisting} />}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Projektname"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              {!fromExisting && <>
                <Field label="Firma"><Input value={contact.company ?? ""} onChange={(e) => setContact({ ...contact, company: e.target.value })} /></Field>
                <Field label="Nachname"><Input value={contact.last_name ?? ""} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} /></Field>
                <Field label="E-Mail"><Input value={contact.email ?? ""} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
              </>}
            </div>
          </div>
        ) : (
          <p className="text-sm">Projekt <b>{p.projectNr ?? `#${p.projectId}`}</b></p>
        )}

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {sources.length
              ? <>Vorlage: {sources.map((d) => `${d.kind === "ab" ? "AB" : "Angebot"} ${d.nr}${d.date ? ` vom ${formatDate(d.date)}` : ""}${d.projectNr ? ` (${d.projectNr})` : ""}`).join(" · ")} – Preise und Texte unverändert aus HERO.</>
              : "Keine frühere AB und kein Angebot gefunden."}
          </p>
          {positions.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr><th className="w-8 p-2" /><th className="p-2 text-left">Position</th><th className="w-36 p-2 text-left">Menge</th><th className="w-28 p-2 text-right">Einzelpreis</th><th className="w-28 p-2 text-right">Summe</th></tr>
                </thead>
                <tbody className="divide-y">
                  {positions.map((x, i) => (
                    <tr key={`${x.sourceDocId}-${x.uid}`} className={cn(!x.include && "opacity-50")}>
                      <td className="p-2 align-top"><input type="checkbox" checked={x.include} onChange={(e) => upd(i, { include: e.target.checked })} aria-label={`${x.name} übernehmen`} /></td>
                      <td className="p-2 align-top">
                        <div className="font-medium">{x.name}{x.nr && <span className="ml-1 text-xs font-normal text-muted-foreground">Art. {x.nr}</span>}</div>
                        {x.description && <div className="line-clamp-2 text-xs text-muted-foreground">{x.description}</div>}
                        {x.note && <div className="text-xs text-amber-800">{x.note}</div>}
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex items-center gap-1">
                          <Input type="number" min={0} step="any" className="h-8 w-20" value={x.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} aria-label="Menge" />
                          <span className="text-xs">{x.unit}</span>
                        </div>
                        {x.quantity !== x.sourceQuantity && <div className="text-xs text-muted-foreground">Vorlage: {x.sourceQuantity}</div>}
                      </td>
                      <td className="p-2 text-right align-top tabular-nums">{euro(x.netPrice)}</td>
                      <td className="p-2 text-right align-top tabular-nums">{euro(x.include ? x.quantity * x.netPrice : 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t font-medium"><td colSpan={4} className="p-2 text-right">Netto</td><td className="p-2 text-right tabular-nums">{euro(sum)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </div>

        {open.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Offen – bitte in HERO ergänzen:</p>
            <ul className="list-disc pl-5">{open.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </div>
        )}

        {steps.length > 0 && (
          <Field label="Status danach">
            <Select className="sm:w-72" value={toStepId} onChange={(e) => setToStepId(e.target.value ? Number(e.target.value) : "")}>
              {steps.map((x) => <option key={x.stepId} value={x.stepId}>{x.label}</option>)}
              <option value="">Status nicht ändern</option>
            </Select>
          </Field>
        )}

    </SuggestionCard>
  );
}

interface DocInfo {
  id: number; nr: string; statusCode: number; statusName: string; value: number | null; projectNr: string | null;
  hasPdf: boolean; sent: boolean; templates: { id: number; name: string }[]; suggestedTemplateId: number | null;
}

/** Geprüftes Dokument (AB oder Angebot) per Klick über HERO an den Kunden senden – mit HERO-Vorlage und PDF. */
export function SendDocumentCard({ s, embedded }: { s: Suggestion; embedded?: boolean }) {
  const p = s.payload;
  const kindLabel = p.kind === "offer" ? "Angebot" : "Auftragsbestätigung";
  const decide = useDecide(s, (r) => (r.alreadySent ? "War schon versendet – erledigt." : `${r.documentNr ?? kindLabel} an ${r.recipient} versendet.`));
  const info = useQuery({
    queryKey: ["document_info", p.documentId],
    queryFn: () => api<DocInfo>("document_info", { documentId: p.documentId, kind: p.kind, formality: p.formality }),
  });
  const [recipient, setRecipient] = useState<string>(p.recipient ?? "");
  const [templateId, setTemplateId] = useState<number | "">("");
  const d = info.data;
  const tpl = templateId || d?.suggestedTemplateId || "";
  const ready = !!d?.hasPdf && !d.sent;
  const validRecipient = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(recipient.trim());

  const send = () => {
    if (!confirm(`${d?.nr ?? kindLabel} jetzt über HERO an ${recipient.trim()} senden?`)) return;
    decide.mutate({ decision: "accept", edits: { recipient: recipient.trim(), templateId: Number(tpl) } });
  };

  return (
    <SuggestionCard
      s={s} embedded={embedded} brief={`${kindLabel} ${d?.nr || p.documentNr || `#${p.documentId}`} an ${recipient || "?"}${d ? ` · ${d.sent ? "schon versendet" : d.hasPdf ? "bereit" : "noch Entwurf"}` : ""}`}
      actions={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {d?.sent ? (
              <Button onClick={() => decide.mutate({ decision: "accept", edits: { recipient: recipient.trim(), templateId: Number(tpl) } })} disabled={decide.isPending}>Als erledigt markieren</Button>
            ) : (
              <Button onClick={send} disabled={!ready || !tpl || !validRecipient || decide.isPending} className="h-auto min-h-9 whitespace-normal py-2 text-left">
                {decide.isPending ? <Spinner /> : <Send className="h-4 w-4" />} {d?.nr || p.documentNr || kindLabel} jetzt über HERO an {recipient.trim() || "?"} senden
              </Button>
            )}
            <Button variant="outline" onClick={() => decide.mutate({ decision: "reject", edits: { reason: "Nicht versenden" } })} disabled={decide.isPending}>Nicht versenden</Button>
          </div>
          {d && !d.hasPdf && <p className="text-xs text-amber-800">Noch ein Entwurf ohne PDF – unter „Vorschlag“ steht, was zu tun ist.</p>}
        </div>
      }
    >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{kindLabel} <b>{d?.nr || p.documentNr || `#${p.documentId}`}</b> · Projekt <b>{p.projectNr ?? p.projectId}</b></span>
          {d && <Badge variant={d.sent ? "good" : d.hasPdf ? "default" : "warn"}>{d.statusName || (d.hasPdf ? "Erstellt" : "Entwurf")}</Badge>}
          {d?.value != null && <span className="text-muted-foreground">{euro(d.value)} netto</span>}
          <Button variant="ghost" size="sm" onClick={() => info.refetch()} disabled={info.isFetching}>
            {info.isFetching ? <Spinner /> : <RefreshCw className="h-3 w-3" />} Status in HERO prüfen
          </Button>
        </div>
        <ErrorBox error={info.error} />

        {d && !d.hasPdf && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Noch ein Entwurf. Bitte in HERO öffnen ({p.projectNr ?? "Projekt"} → Dokumente), Positionen und Preise prüfen und das Dokument
            <b> abschließen</b> (PDF erzeugen) – dann hier „Status in HERO prüfen“ und versenden.
            <a className="ml-1 inline-flex items-center gap-1 underline" href="https://login.hero-software.de" target="_blank" rel="noreferrer">HERO öffnen <ExternalLink className="h-3 w-3" /></a>
          </div>
        )}
        {d?.sent && <p className="text-sm text-emerald-800">Ist in HERO schon als versendet markiert.</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Empfänger" hint="Zum Testen zuerst die eigene Adresse eintragen.">
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </Field>
          <Field label="HERO-Mailvorlage">
            <Select value={tpl} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : "")}>
              <option value="" disabled>Vorlage wählen …</option>
              {d?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">
          Echter Versand an den Kunden: HERO verschickt die Mail mit der gewählten Vorlage (Betreff und Text aus HERO) und dem PDF; der Versand steht im HERO-Verlauf und im Logbuch.
        </p>
    </SuggestionCard>
  );
}
