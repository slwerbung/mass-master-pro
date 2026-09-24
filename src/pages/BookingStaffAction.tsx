// /termin/intern/:token?mode=cancel|reschedule — die zwei Knoepfe aus unserer
// internen Benachrichtigungsmail.
//
// Kein Login: der Token steht nur in der Mail an uns, haengt an genau diesem
// einen Termin und laeuft mit ihm ab. Auch hier wird bewusst nachgefragt,
// damit ein Link-Vorschau-Scanner nichts ausloest.
//
// Beide Wege geben den Platz SOFORT frei (so abgestimmt). Der Unterschied
// liegt in der Mail an den Kunden: Umbuchen bittet um einen neuen Termin,
// Absagen ist eine Absage.

import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CalendarClock, CalendarX, CheckCircle2, Loader2 } from "lucide-react";
import { staffBookingAction } from "@/lib/bookingApi";

export default function BookingStaffAction() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const mode = params.get("mode") === "cancel" ? "cancel" : "reschedule";

  const [state, setState] = useState<"frage" | "laeuft" | "fertig" | "fehler">("frage");
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const umbuchen = mode === "reschedule";

  async function ausfuehren() {
    setState("laeuft");
    try {
      const res = await staffBookingAction(token, mode);
      setAlready(!!res.already);
      setState("fertig");
    } catch (e) {
      setError((e as Error).message);
      setState("fehler");
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            {state === "fertig" ? (
              <>
                <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600" />
                <p className="text-lg font-semibold">
                  {already ? "War schon ausgetragen" : umbuchen ? "Umbuchung angestoßen" : "Termin abgesagt"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {already
                    ? "Dieser Termin war bereits abgesagt — es wurde nichts zusätzlich verschickt."
                    : umbuchen
                      ? "Der Kunde bekommt die Bitte, selbst einen neuen Termin zu wählen. Der Platz ist wieder frei."
                      : "Der Kunde bekommt eine Absage. Der Platz ist wieder frei."}
                </p>
                <p className="text-xs text-muted-foreground">
                  In HERO ist der Termin ebenfalls entfernt, falls er dort angelegt war.
                </p>
              </>
            ) : state === "fehler" ? (
              <>
                <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="font-medium">Das hat nicht geklappt</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </>
            ) : (
              <>
                {umbuchen
                  ? <CalendarClock className="h-9 w-9 mx-auto text-muted-foreground" />
                  : <CalendarX className="h-9 w-9 mx-auto text-muted-foreground" />}
                <p className="text-lg font-semibold">
                  {umbuchen ? "Kunden um einen neuen Termin bitten?" : "Termin endgültig absagen?"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {umbuchen
                    ? "Der Termin wird ausgetragen und der Kunde bekommt eine Mail mit der Bitte, selbst einen neuen zu wählen."
                    : "Der Termin wird ausgetragen und der Kunde bekommt eine Absage."}
                </p>
                <Button
                  className="w-full" variant={umbuchen ? "default" : "destructive"}
                  disabled={state === "laeuft"} onClick={ausfuehren}
                >
                  {state === "laeuft"
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> läuft…</>
                    : umbuchen ? "Ja, umbuchen lassen" : "Ja, absagen"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
