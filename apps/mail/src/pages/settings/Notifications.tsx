import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { api } from "@/lib/api";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported, type PushStatus } from "@/lib/push";
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Spinner, Switch } from "@/components/ui";
import { errorText } from "@/lib/utils";

/** Benachrichtigungen – jeder Benutzer fuer sich, je Geraet ein- und ausschaltbar. */
export default function Notifications() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["push-status"],
    queryFn: async () => {
      const sub = await currentSubscription().catch(() => null);
      return api<PushStatus>("push_status", { endpoint: sub?.endpoint ?? "" });
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["push-status"] });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => (on ? enablePush(status.data!.publicKey) : disablePush()),
    onSuccess: (_r, on) => { toast.success(on ? "Benachrichtigungen auf diesem Gerät eingeschaltet." : "Auf diesem Gerät ausgeschaltet."); refresh(); },
    onError: (e) => { toast.error(errorText(e)); refresh(); },
  });
  const prefs = useMutation({
    mutationFn: (p: Partial<PushStatus["prefs"]>) => api("push_prefs", p),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  const test = useMutation({
    mutationFn: () => api<{ sent: number }>("push_test"),
    onSuccess: (r) => toast.success(`Test gesendet (${r.sent} Gerät${r.sent === 1 ? "" : "e"}).`),
    onError: (e) => toast.error(errorText(e)),
  });

  if (status.isLoading) return <Spinner />;
  const s = status.data;
  const iosHint = isIos() && !isStandalone();
  const blocked = pushSupported() && Notification.permission === "denied";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Push-Nachrichten aufs Handy oder an den Computer, wenn eine neue Mail eintrifft. Gilt nur für dich; je Gerät einzeln einschalten.
      </p>
      <ErrorBox error={status.error} />
      <Card>
        <CardHeader><CardTitle>Dieses Gerät</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {iosHint ? (
            <p>Auf dem iPhone/iPad gehen Benachrichtigungen nur aus der installierten App: in Safari <b>Teilen → Zum Home-Bildschirm</b>, dann die App vom Home-Bildschirm öffnen und hier einschalten.</p>
          ) : !pushSupported() ? (
            <p>Dieser Browser kann keine Benachrichtigungen empfangen.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {s?.subscribed
                  ? <><Bell className="h-4 w-4 text-green-700" /> Eingeschaltet</>
                  : <><BellOff className="h-4 w-4 text-muted-foreground" /> Ausgeschaltet</>}
                <Button size="sm" variant={s?.subscribed ? "outline" : "default"} disabled={toggle.isPending || !s} onClick={() => toggle.mutate(!s?.subscribed)}>
                  {toggle.isPending && <Spinner />} {s?.subscribed ? "Ausschalten" : "Einschalten"}
                </Button>
                {s?.subscribed && <Button size="sm" variant="ghost" disabled={test.isPending} onClick={() => test.mutate()}>Test senden</Button>}
              </div>
              {blocked && <p className="text-amber-800">Der Browser blockiert Benachrichtigungen für diese Seite – in den Website-Einstellungen (Schloss-Symbol) erlauben.</p>}
            </>
          )}
          {!!s?.devices && <p className="text-xs text-muted-foreground">Angemeldete Geräte insgesamt: {s.devices}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Wofür</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Switch checked={s?.prefs.decide ?? true} disabled={prefs.isPending} onChange={(v) => prefs.mutate({ decide: v })} label="Neue Mails unter „Zu entscheiden“" />
            <p className="ml-11 text-xs text-muted-foreground">Ist eine Mail ausdrücklich an jemanden gerichtet, bekommt nur er die Nachricht.</p>
          </div>
          <div>
            <Switch checked={s?.prefs.incoming ?? false} disabled={prefs.isPending} onChange={(v) => prefs.mutate({ incoming: v })} label="Auch alle anderen eingehenden Mails" />
            <p className="ml-11 text-xs text-muted-foreground">Z. B. Newsletter, Belege, Systemmails – ohne Werbung/Spam.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
