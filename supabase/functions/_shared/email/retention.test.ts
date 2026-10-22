import { describe, expect, it } from "vitest";
import { runRetention, type RetentionDeps } from "./retention.ts";

function fake(total: number, failRemove = false) {
  let left = Array.from({ length: total }, (_, i) => ({ id: `a${i}`, storage_path: `p/${i}` }));
  const log = { removed: [] as string[], cleared: [] as string[], finished: 0 };
  const deps: RetentionDeps = {
    due: async (limit) => left.slice(0, limit),
    remove: async (paths) => { if (failRemove) throw new Error("kaputt"); log.removed.push(...paths); },
    clear: async (ids) => { log.cleared.push(...ids); left = left.filter((r) => !ids.includes(r.id)); },
    finish: async () => { log.finished++; },
  };
  return { deps, log };
}

describe("runRetention", () => {
  it("löscht in Portionen, leert die Verweise und kürzt danach die Texte", async () => {
    const { deps, log } = fake(250);
    expect(await runRetention(deps, 100)).toEqual({ files: 250, more: false });
    expect(log.removed).toHaveLength(250);
    expect(log.cleared).toEqual(log.removed.map((p) => `a${p.slice(2)}`));
    expect(log.finished).toBe(1);
  });

  it("ohne fällige Anhänge nur die Texte", async () => {
    const { deps, log } = fake(0);
    expect(await runRetention(deps)).toEqual({ files: 0, more: false });
    expect(log.finished).toBe(1);
  });

  it("schlägt das Löschen fehl, bleiben die Verweise stehen", async () => {
    const { deps, log } = fake(3, true);
    await expect(runRetention(deps)).rejects.toThrow("kaputt");
    expect(log.cleared).toEqual([]);
    expect(log.finished).toBe(0);
  });

  it("begrenzt einen Lauf und meldet den Rest", async () => {
    const { deps, log } = fake(30);
    expect(await runRetention(deps, 1)).toEqual({ files: 20, more: true });
    expect(log.finished).toBe(1);
  });
});
