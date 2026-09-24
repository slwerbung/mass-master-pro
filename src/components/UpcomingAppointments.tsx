// Terminleiste auf der Startseite: was heute und morgen ansteht.
//
// Liest direkt aus Supabase — `booking` ist per RLS fuer Mitarbeiter lesbar
// (is_staff()). Ohne Mitarbeiter-Sitzung kommt schlicht nichts zurueck, dann
// zeigt die Leiste auch nichts: sie darf die Startseite nie blockieren oder
// mit einer Fehlermeldung zumuellen.
//
// Bewusst schmal: heute und morgen als Standard, auf Klick die naechsten
// sieben Tage. Wer mehr will, geht ins Adminmenue.

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, ChevronDown, ChevronUp, MapPin } from "lucide-react";

const TZ = "Europe/Berlin";

interface Termin {
  id: string;
  starts_at: string;
  ends_at: string;
  customer_name: string | null;
  address: string | null;
  status: string;
  staff: { display_name: string } | null;
}

export function UpcomingAppointments() {
  const [termine, setTermine] = useState<Termin[]>([]);
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    let alive = true;
    const von = DateTime.now().setZone(TZ).startOf("day");
    supabase
      .from("booking")
      .select("id, starts_at, ends_at, customer_name, address, status, staff:staff_id ( display_name )")
      .in("status", ["pending", "confirmed"])
      .gte("starts_at", von.toUTC().toISO()!)
      .lt("starts_at", von.plus({ days: 7 }).toUTC().toISO()!)
      .order("starts_at")
      .limit(30)
      .then(({ data }) => { if (alive) setTermine((data as unknown as Termin[]) ?? []); });
    return () => { alive = false; };
  }, []);

  if (termine.length === 0) return null;

  const heute = DateTime.now().setZone(TZ).startOf("day");
  const grenze = heute.plus({ days: 2 });
  const naechste = termine.filter((t) => DateTime.fromISO(t.starts_at, { zone: "utc" }).setZone(TZ) < grenze);
  const spaeter = termine.length - naechste.length;
  const liste = offen ? termine : naechste;

  // Nichts heute oder morgen, aber spaeter etwas: dann nur der Hinweis.
  if (liste.length === 0 && !offen) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-2.5 px-3 flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="h-4 w-4" /> Heute und morgen keine Termine
          </span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setOffen(true)}>
            {spaeter} in den nächsten Tagen <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-2.5 px-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Aufmaß-Termine
          </span>
          {(spaeter > 0 || offen) && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOffen((o) => !o)}>
              {offen
                ? <>heute und morgen <ChevronUp className="h-3.5 w-3.5 ml-1" /></>
                : <>+{spaeter} später <ChevronDown className="h-3.5 w-3.5 ml-1" /></>}
            </Button>
          )}
        </div>
        <div className="divide-y">
          {liste.map((t) => {
            const d = DateTime.fromISO(t.starts_at, { zone: "utc" }).setZone(TZ).setLocale("de");
            const istHeute = d.startOf("day").equals(heute);
            return (
              <div key={t.id} className="py-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="tabular-nums font-medium">
                  {istHeute ? "heute" : d.toFormat("ccc dd.LL.")} {d.toFormat("HH:mm")}
                </span>
                <span className="text-muted-foreground">{t.staff?.display_name ?? "—"}</span>
                <span className="truncate max-w-[45%]">{t.customer_name}</span>
                {t.address && (
                  <span className="text-muted-foreground truncate max-w-[45%] flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />{t.address}
                  </span>
                )}
                {t.status === "pending" && <Badge variant="outline" className="h-5">wartet</Badge>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default UpcomingAppointments;
