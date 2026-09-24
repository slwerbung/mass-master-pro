// /termin/absagen/:token — der Absage-Link aus der Bestaetigungsmail.
//
// Bewusst mit Rueckfrage: ein Mailprogramm, das Links vorab anklickt (Outlook
// Safe Links, Virenscanner), wuerde den Termin sonst von allein absagen.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CalendarX, CheckCircle2, Loader2 } from "lucide-react";
import { cancelBooking } from "@/lib/bookingApi";

export default function BookingCancel() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"frage" | "laeuft" | "weg" | "fehler">("frage");
  const [error, setError] = useState<string | null>(null);

  async function absagen() {
    setState("laeuft");
    try {
      await cancelBooking(token);
      setState("weg");
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
            {state === "weg" ? (
              <>
                <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600" />
                <p className="text-lg font-semibold">Termin ist abgesagt</p>
                <p className="text-sm text-muted-foreground">
                  Danke für die Rückmeldung — der Platz ist wieder frei. Wenn Sie einen neuen
                  Termin brauchen, nutzen Sie einfach den Buchungslink aus Ihrer E-Mail.
                </p>
              </>
            ) : state === "fehler" ? (
              <>
                <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="font-medium">Das hat nicht geklappt</p>
                <p className="text-sm text-muted-foreground">{error}</p>
                <p className="text-sm text-muted-foreground">
                  Bitte antworten Sie kurz auf unsere E-Mail, dann tragen wir den Termin aus.
                </p>
              </>
            ) : (
              <>
                <CalendarX className="h-9 w-9 mx-auto text-muted-foreground" />
                <p className="text-lg font-semibold">Termin absagen?</p>
                <p className="text-sm text-muted-foreground">
                  Der Platz wird dann sofort wieder freigegeben.
                </p>
                <Button
                  variant="destructive" className="w-full"
                  disabled={state === "laeuft"} onClick={absagen}
                >
                  {state === "laeuft"
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> wird abgesagt…</>
                    : "Ja, Termin absagen"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
