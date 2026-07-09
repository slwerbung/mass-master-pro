import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, AlertTriangle, FileCheck2 } from "lucide-react";

// Public page: reached from the buttons in a HERO offer e-mail
//   https://captfix.app/hero-aktion?pid={{ProjectMatch.id}}&a=<annehmen|ablehnen|ruecksprache>
//     (optionally &doc={{CustomerDocument.id}})
//
// It deliberately performs the action ONLY on the explicit "Bestätigen" click
// (link/virus scanners open URLs but don't run JS, so they never trigger it).
// On load it does a read-only lookup to show the friendly project number.

type Action = "annehmen" | "ablehnen" | "ruecksprache";
type Phase = "confirm" | "processing" | "done" | "error" | "invalid";

const ACTION_LABEL: Record<Action, string> = {
  annehmen: "Angebot annehmen",
  ablehnen: "Angebot ablehnen",
  ruecksprache: "Rücksprache anfragen",
};
const ACTION_QUESTION: Record<Action, string> = {
  annehmen: "wirklich annehmen",
  ablehnen: "wirklich ablehnen",
  ruecksprache: "eine Rücksprache anfragen",
};
const DONE_TEXT: Record<Action, string> = {
  annehmen: "Vielen Dank – Ihre Zusage ist bei uns eingegangen. Wir melden uns mit den nächsten Schritten.",
  ablehnen: "Vielen Dank für Ihre Rückmeldung. Ihre Absage ist bei uns eingegangen.",
  ruecksprache: "Vielen Dank – Ihre Anfrage zur Rücksprache ist eingegangen. Wir melden uns zeitnah bei Ihnen.",
};

async function invokeErr(fnErr: any): Promise<string> {
  let msg = fnErr?.message || "Unbekannter Fehler";
  try {
    const ctx = fnErr?.context;
    const b = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
    if (b?.error) msg = b.error;
  } catch { /* keep generic */ }
  return msg;
}

export default function HeroOfferAction() {
  const [params] = useSearchParams();
  const pid = (params.get("pid") || "").trim();       // internal ProjectMatch.id
  const displayId = (params.get("p") || "").trim();   // fallback: project number
  const documentId = (params.get("doc") || "").trim();
  const action = (params.get("a") || "").trim() as Action;

  const valid = useMemo(
    () => ["annehmen", "ablehnen", "ruecksprache"].includes(action) && (!!pid || !!displayId),
    [action, pid, displayId],
  );

  const [phase, setPhase] = useState<Phase>(valid ? "confirm" : "invalid");
  const [error, setError] = useState("");
  const [projectLabel, setProjectLabel] = useState<string>(displayId || (pid ? `#${pid}` : ""));
  const [offerLabel, setOfferLabel] = useState<string>(documentId ? `#${documentId}` : "");
  const [brand, setBrand] = useState<{ logo: string | null; name: string }>({ logo: null, name: "" });

  // Company branding from the admin dashboard (public actions, no token).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [logoRes, legalRes] = await Promise.all([
          supabase.functions.invoke("admin-manage", { body: { action: "get_logo" } }),
          supabase.functions.invoke("admin-manage", { body: { action: "get_legal_info" } }),
        ]);
        if (cancelled) return;
        setBrand({
          logo: (logoRes.data as any)?.logo || null,
          name: (legalRes.data as any)?.info?.companyName || "",
        });
      } catch { /* keep neutral header */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const bodyBase = useMemo(
    () => ({ action, projectMatchId: pid ? Number(pid) : undefined, displayId: displayId || undefined, documentId: documentId || undefined }),
    [action, pid, displayId, documentId],
  );

  // Read-only lookup on load to show the friendly project number.
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("hero-offer-action", {
          body: { ...bodyBase, mode: "lookup" },
        });
        if (cancelled) return;
        if (!fnErr && (data as any)?.ok) {
          if ((data as any).projectNr) setProjectLabel((data as any).projectNr);
          if ((data as any).offerNr) setOfferLabel((data as any).offerNr);
        }
      } catch { /* keep fallback label */ }
    })();
    return () => { cancelled = true; };
  }, [valid, bodyBase]);

  const confirm = async () => {
    setPhase("processing");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("hero-offer-action", {
        body: { ...bodyBase, mode: "execute" },
      });
      if (fnErr) throw new Error(await invokeErr(fnErr));
      if ((data as any)?.ok === false) throw new Error((data as any).error || "Aktion fehlgeschlagen");
      if ((data as any)?.projectDisplayId) setProjectLabel((data as any).projectDisplayId);
      if ((data as any)?.offerNr) setOfferLabel((data as any).offerNr);
      setPhase("done");
    } catch (e: any) {
      setError(e?.message || "Unbekannter Fehler");
      setPhase("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          {brand.logo ? (
            <img src={brand.logo} alt={brand.name || "Logo"} className="mx-auto mb-2 max-h-16 w-auto object-contain" />
          ) : (
            <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileCheck2 className="h-6 w-6" />
            </div>
          )}
          <CardTitle className="text-xl">{brand.name || "Angebots-Rückmeldung"}</CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">Angebots-Rückmeldung</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {phase === "invalid" && (
            <div className="text-center space-y-2">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
              <p className="text-sm text-muted-foreground">
                Dieser Link ist unvollständig oder ungültig. Bitte öffnen Sie den Button erneut aus Ihrer Angebots-E-Mail.
              </p>
            </div>
          )}

          {phase === "confirm" && (
            <>
              <p className="text-center text-sm">
                Möchten Sie das Angebot <strong>{offerLabel || "—"}</strong> {ACTION_QUESTION[action]}?
              </p>
              {projectLabel && (
                <p className="text-center text-xs text-muted-foreground -mt-2">Projekt {projectLabel}</p>
              )}
              <Button className="w-full" size="lg" onClick={confirm}>
                {ACTION_LABEL[action]} · Bestätigen
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Erst mit „Bestätigen“ wird Ihre Rückmeldung an uns übermittelt.
              </p>
            </>
          )}

          {phase === "processing" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Ihre Rückmeldung wird übermittelt…</p>
            </div>
          )}

          {phase === "done" && (
            <div className="text-center space-y-2 py-2">
              <CheckCircle2 className="mx-auto h-9 w-9 text-green-600" />
              <p className="text-sm">{DONE_TEXT[action]}</p>
              <p className="text-xs text-muted-foreground">
                Angebot {offerLabel || "—"}{projectLabel ? ` · Projekt ${projectLabel}` : ""}
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
              <Button variant="outline" className="w-full" onClick={confirm}>Erneut versuchen</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
