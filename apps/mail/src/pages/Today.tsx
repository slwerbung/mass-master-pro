import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Briefcase, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { CATEGORY_NAMES, CATEGORY_STYLE, papi, tageText, type PCategory, type ProjectList } from "@/lib/projects";
import type { Topic } from "@/lib/topics";
import { Badge, Card, CardContent, ErrorBox, Spinner } from "@/components/ui";
import { cn, formatDate } from "@/lib/utils";

interface Item {
  key: string; kind: "mail" | "projekt" | "wiedervorlage"; title: string; sub: string; meta: string; to: string; category: PCategory;
}
const RANK: Record<PCategory, number> = { kunde: 1, auftrag: 2, termine: 3, pflege: 4 };
const KIND_RANK = { mail: 0, projekt: 1, wiedervorlage: 2 } as const;
const MAX = 60;

/** Ende des heutigen Tages (Ortszeit des Geraets) – Wiedervorlagen bis dahin gelten als „heute“. */
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };

/**
 * „Heute“ (Phase 5): Mail-Themen aus „Zu entscheiden“ und Projekt-Karten in EINER Liste, Kundensachen zuerst,
 * dazu die Wiedervorlagen, die heute fällig werden. Jede Zeile führt in die jeweilige Ansicht.
 */
export default function Today() {
  const topics = useQuery({ queryKey: ["topics", "entscheiden"], queryFn: () => api<Topic[]>("list_topics", { view: "entscheiden" }), refetchInterval: 60_000 });
  const projects = useQuery({ queryKey: ["projects", "list"], queryFn: () => papi<ProjectList>("list"), refetchInterval: 60_000 });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const t of topics.data ?? []) {
      out.push({ key: `m:${t.id}`, kind: "mail", category: "kunde", title: t.subject || "(ohne Betreff)", sub: `${t.from}${t.reasonText ? ` · ${t.reasonText}` : ""}`, meta: t.lastActivity ? formatDate(t.lastActivity) : "", to: "/" });
    }
    for (const c of projects.data?.stack ?? []) {
      out.push({ key: `p:${c.id}`, kind: "projekt", category: c.category, title: `${c.project.nr} ${c.project.name || ""}`.trim(), sub: c.reasons.text || c.ruleLabel, meta: `${c.project.stepName.replace(/^[^\p{L}\p{N}]+/u, "")} · ${tageText(c.project.days)}`, to: `/projekte?card=${c.id}` });
    }
    const limit = endOfToday();
    for (const f of projects.data?.followups ?? []) {
      if (Date.parse(f.dueAt) > limit) continue;
      out.push({ key: `f:${f.id}`, kind: "wiedervorlage", category: "pflege", title: `${f.project.nr} ${f.project.name || ""}`.trim(), sub: `Wiedervorlage heute: ${f.reason}`, meta: formatDate(f.dueAt), to: "/projekte" });
    }
    // stabil: Kundenthemen zuerst, dann Auftrag/Termine/Pflege; innerhalb Mails vor Projekten (die Reihenfolge der Quellen bleibt)
    return out.map((it, i) => ({ it, i })).sort((a, b) => RANK[a.it.category] - RANK[b.it.category] || KIND_RANK[a.it.kind] - KIND_RANK[b.it.kind] || a.i - b.i).map((x) => x.it);
  }, [topics.data, projects.data]);

  const count = (k: Item["kind"]) => items.filter((i) => i.kind === k).length;
  const loading = topics.isLoading || projects.isLoading;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Heute</h1>
        {!loading && <span className="text-sm text-muted-foreground">{count("mail")} Mail-Themen · {count("projekt")} Projekt-Karten · {count("wiedervorlage")} Wiedervorlagen heute</span>}
      </div>
      <ErrorBox error={topics.error ?? projects.error} />
      {loading && <Spinner />}
      {!loading && !items.length && <p className="text-sm text-muted-foreground">Heute ist nichts offen.</p>}
      <div className="space-y-2">
        {items.slice(0, MAX).map((it) => (
          <Link key={it.key} to={it.to} className="block">
            <Card className="transition-colors hover:bg-accent">
              <CardContent className="flex items-center gap-3 py-3">
                {it.kind === "mail" ? <Mail className="h-4 w-4 shrink-0 text-muted-foreground" /> : it.kind === "projekt" ? <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" /> : <AlarmClock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{it.sub}</div>
                </div>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", it.kind === "mail" ? CATEGORY_STYLE.kunde : CATEGORY_STYLE[it.category])}>
                  {it.kind === "mail" ? "Mail" : it.kind === "wiedervorlage" ? "Wiedervorlage" : CATEGORY_NAMES[it.category]}
                </span>
                {it.meta && <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">{it.meta}</Badge>}
              </CardContent>
            </Card>
          </Link>
        ))}
        {items.length > MAX && <p className="text-xs text-muted-foreground">… und {items.length - MAX} weitere – im Stapel unter „Projekte“ bzw. „Zu entscheiden“.</p>}
      </div>
    </div>
  );
}
