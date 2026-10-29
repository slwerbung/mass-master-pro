import { describe, expect, it } from "vitest";
import { AccessError, assertMessages, assertSuggestion, assertThread, canAccount, scopeAccounts } from "./access.ts";

const admin = { accountIds: null };
const anna = { accountIds: ["a1"] };

/** Mini-Supabase: liefert Zeilen je Tabelle, gefiltert nach eq/in auf `id`. */
function fakeSb(tables: Record<string, any[]>) {
  return {
    from: (t: string) => {
      let rows = tables[t] ?? [];
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: any) => res({ data: rows, error: null }),
      };
      return q;
    },
  };
}

const sb = fakeSb({
  email_messages: [{ id: "m1", account_id: "a1" }, { id: "m2", account_id: "a2" }],
  email_threads: [{ id: "t1", account_id: "a1" }, { id: "t2", account_id: "a2" }],
  email_suggestions: [{ id: "s1", message_id: "m1" }, { id: "s2", message_id: "m2" }],
});

describe("Zugriff je Postfach", () => {
  it("Admin darf alles, Mitarbeiter nur zugeordnete Postfaecher", () => {
    expect(canAccount(admin, "a2")).toBe(true);
    expect(canAccount(anna, "a1")).toBe(true);
    expect(canAccount(anna, "a2")).toBe(false);
    expect(canAccount(anna, null)).toBe(false);
  });

  it("Abfrage wird nur fuer Mitarbeiter eingeschraenkt", () => {
    const calls: unknown[] = [];
    const q = { in: (c: string, v: string[]) => (calls.push([c, v]), q) };
    scopeAccounts(q, admin);
    expect(calls).toEqual([]);
    scopeAccounts(q, anna, "id");
    expect(calls).toEqual([["id", ["a1"]]]);
  });

  it("Mail, Thema, Vorschlag fremder Postfaecher wird abgewiesen", async () => {
    await expect(assertMessages(sb, anna, ["m1"])).resolves.toBeUndefined();
    await expect(assertMessages(sb, anna, ["m1", "m2"])).rejects.toBeInstanceOf(AccessError);
    await expect(assertThread(sb, anna, "t2")).rejects.toBeInstanceOf(AccessError);
    await expect(assertThread(sb, anna, "t1")).resolves.toBeUndefined();
    await expect(assertSuggestion(sb, anna, "s2")).rejects.toBeInstanceOf(AccessError);
    await expect(assertSuggestion(sb, admin, "s2")).resolves.toBeUndefined();
  });

  it("unbekannte IDs fallen durch (der Aufrufer meldet „nicht gefunden“)", async () => {
    await expect(assertMessages(sb, anna, ["gibtsnicht", null, undefined])).resolves.toBeUndefined();
  });
});
