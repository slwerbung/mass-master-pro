import { describe, expect, it } from "vitest";
import { listTopics } from "./topicsDb.ts";

/** Kleines Supabase-Double: filtert eq/neq/in/is(null); alles andere wird ignoriert. */
function fakeSb(tables: Record<string, any[]>) {
  return {
    from(t: string) {
      let rows = [...(tables[t] ?? [])];
      const q: any = {
        select: () => q, order: () => q, limit: () => q, not: () => q, or: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        neq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] !== v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        is: (k: string, v: unknown) => ((rows = rows.filter((r) => (r[k] ?? null) === v)), q),
        update: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: any) => res({ data: rows, error: null }),
      };
      return q;
    },
  };
}

const now = new Date("2026-10-29T10:00:00Z");
const thread = (id: string) => ({ id, account_id: "a1", subject_norm: id, topic_state: "aktiv", snoozed_until: null, topic_note: null, reviewed_at: null, closed_at: null, hero_project_match_id: null, last_activity_at: "2026-10-29T08:00:00Z" });
const mail = (id: string, thread_id: string, body: string) => ({
  id, account_id: "a1", thread_id, direction: "in", from_name: "Kunde", from_addr: "k@x.de", subject: "Anfrage", sent_at: "2026-10-29T08:00:00Z",
  created_at: "2026-10-29T08:00:00Z", summary: null, category: "anfrage_neu", status: "zugeordnet", beleg_state: null, has_attachments: false,
  decided_at: null, hero_project_match_id: null, to_addrs: ["info@slwerbung.de"], body_text: body, trashed_at: null,
});
const sb = fakeSb({
  email_config: [],
  email_suggestions: [],
  email_threads: [thread("t1"), thread("t2")],
  email_messages: [mail("m1", "t1", "Hallo Jonas,\nanbei die Maße."), mail("m2", "t2", "Hallo zusammen,\nwir brauchen ein Schild.")],
});
const audience = new Map([["a1", [{ id: "silas", name: "Silas Werner", emails: [] }, { id: "jonas", name: "Jonas Lang", emails: [] }]]]);

describe("Zu entscheiden: nur was an mich (oder an alle) gerichtet ist", () => {
  it("an Jonas gerichtet: nur Jonas bekommt es, Silas sieht es unter „Laufend“", async () => {
    const silas = await listTopics(sb, "entscheiden", now, { accountIds: null, userId: "silas", audience });
    expect(silas.map((t) => t.id)).toEqual(["t2"]);
    const jonas = await listTopics(sb, "entscheiden", now, { accountIds: ["a1"], userId: "jonas", audience });
    expect(jonas.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(jonas.find((t) => t.id === "t1")?.newMessages[0].addressedTo).toBe("Jonas Lang");
    const laufend = await listTopics(sb, "laufend", now, { accountIds: null, userId: "silas", audience });
    expect(laufend.map((t) => t.id)).toEqual(["t1"]);
  });

  it("ohne Betrachter (z. B. Detailansicht) keine Einschränkung", async () => {
    const all = await listTopics(sb, "entscheiden", now, null);
    expect(all.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });
});
