import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Mail, Paperclip, PenLine, Send } from "lucide-react";
import { api } from "@/lib/api";
import type { Account, MessageRow } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/shared";
import { Badge, Button, ErrorBox, Input, Select, Spinner } from "@/components/ui";
import { CategoryChip } from "@/components/CategoryChip";
import { formatDateTime, pct } from "@/lib/utils";

const PAGE = 50;
const STATUS_LABELS: Record<string, string> = {
  neu: "Neu", klassifiziert: "Verstanden", zugeordnet: "Zugeordnet", ohne_bezug: "Ohne Bezug", erledigt: "Erledigt", wartet: "Wartet auf Freigabe", fehler: "Fehler",
};

export default function Messages() {
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(0);
  const f = {
    q: sp.get("q") ?? "", accountId: sp.get("accountId") ?? "", category: sp.get("category") ?? "", status: sp.get("status") ?? "",
    hero: sp.get("hero") ?? "", direction: sp.get("direction") ?? "", from: sp.get("from") ?? "", to: sp.get("to") ?? "",
  };
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
    setPage(0);
  };

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("list_accounts") });
  const list = useQuery({
    queryKey: ["messages", f, page],
    queryFn: () => api<{ messages: MessageRow[]; total: number }>("list_messages", {
      ...f, to: f.to ? `${f.to}T23:59:59` : "", limit: PAGE, offset: page * PAGE,
    }),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alle Mails</h1>
        {list.isFetching && <Spinner />}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input placeholder="Suche (Betreff, Absender, Zusammenfassung)" value={f.q} onChange={(e) => set("q", e.target.value)} />
        <Select value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">Alle Postfächer</option>
          {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
        <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
          <option value="">Alle Kategorien</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </Select>
        <Select value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Alle Status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.hero} onChange={(e) => set("hero", e.target.value)}>
          <option value="">Mit und ohne HERO-Bezug</option>
          <option value="mit">Mit HERO-Bezug</option>
          <option value="ohne">Ohne HERO-Bezug</option>
        </Select>
        <Select value={f.direction} onChange={(e) => set("direction", e.target.value)}>
          <option value="">Eingehend und ausgehend</option>
          <option value="in">Eingehend</option>
          <option value="out">Ausgehend</option>
        </Select>
        <Input type="date" aria-label="Von" value={f.from} onChange={(e) => set("from", e.target.value)} />
        <Input type="date" aria-label="Bis" value={f.to} onChange={(e) => set("to", e.target.value)} />
      </div>

      <ErrorBox error={list.error} />

      <div className="divide-y rounded-lg border bg-card">
        {list.data?.messages.map((m) => (
          <Link key={m.id} to={`/mails/${m.id}`} className="flex flex-col gap-1 p-3 hover:bg-accent/50">
            <div className="flex flex-wrap items-center gap-2">
              {m.direction === "out" ? <Send className="h-4 w-4 text-muted-foreground" aria-label="Ausgehend" /> : <Mail className="h-4 w-4 text-muted-foreground" aria-label="Eingehend" />}
              <span className="font-medium">{m.from_name || m.from_addr}</span>
              <CategoryChip category={m.category} />
              {m.confidence != null && m.confidence < 0.7 && <Badge variant="warn">unsicher {pct(m.confidence)}</Badge>}
              {m.hero_project_match_id && <Badge variant="outline">HERO #{m.hero_project_match_id}</Badge>}
              {m.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-label="Anhänge" />}
              {m.draft_message_id && <PenLine className="h-3.5 w-3.5 text-muted-foreground" aria-label="Entwurf" />}
              {m.status === "fehler" && <Badge variant="danger">Fehler</Badge>}
              {m.status === "wartet" && <Badge variant="warn">Freigabe offen</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.sent_at)}</span>
            </div>
            <div className="truncate text-sm">{m.subject || "(ohne Betreff)"}</div>
            {m.summary && <div className="truncate text-xs text-muted-foreground">{m.summary}</div>}
          </Link>
        ))}
        {list.data && !list.data.messages.length && <div className="p-6 text-sm text-muted-foreground">Keine Mails gefunden.</div>}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} Mails</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</Button>
          <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Weiter</Button>
        </div>
      </div>
    </div>
  );
}
