// Sync-Check Repo <-> Live (Live-Code ist die Wahrheit). Das Manifest enthält die SHA-256 der Dateien, wie sie live in
// hero-calc / hero-offer / hero-calc-contract liegen. Weicht eine Repo-Datei ab, schlägt der Test fehl: erst Live prüfen
// (get_edge_function), dann Repo UND Manifest bewusst nachziehen. Die gemeinsamen Dateien _shared/herocalc/* gibt es im Repo
// nur einmal; live trägt jede Function eine Kopie, die laut Manifest in allen drei Functions identisch sein muss.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./live-manifest.json";

const ROOT = new URL("../../", import.meta.url); // supabase/functions/
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const repoPath = (fn: string, published: string) =>
  published === "source/index.ts" ? `${fn}/index.ts` : published === "source/deno.json" ? `${fn}/deno.json` : published;

const fns = manifest.functions as Record<string, { files: Record<string, string> }>;

describe("Repo == Live-Stand (Manifest)", () => {
  for (const [fn, info] of Object.entries(fns)) {
    it(`${fn}: jede veröffentlichte Datei ist im Repo byteweise gleich`, () => {
      const diffs = Object.entries(info.files)
        .filter(([name, hash]) => sha(readFileSync(new URL(repoPath(fn, name), ROOT), "utf8")) !== hash)
        .map(([name]) => name);
      expect(diffs).toEqual([]);
    });
  }

  it("gemeinsame Dateien (service, ops, calc, guard, overview, parse) sind in allen drei Functions identisch", () => {
    const shared = ["service", "ops", "calc", "guard", "overview", "parse"].map((n) => `_shared/herocalc/${n}.ts`);
    for (const f of shared) {
      const hashes = Object.entries(fns).map(([fn, i]) => [fn, i.files[f]]).filter(([, h]) => h !== undefined);
      expect(hashes.length, `${f} fehlt in einer Function`).toBe(3);
      expect(new Set(hashes.map(([, h]) => h)).size, `${f} weicht zwischen den Functions ab`).toBe(1);
    }
  });

  it("kein API-Key und kein Team-Key im Repo-Code der drei Functions", () => {
    const all = Object.entries(fns).flatMap(([fn, i]) => Object.keys(i.files).map((n) => readFileSync(new URL(repoPath(fn, n), ROOT), "utf8")));
    for (const src of all) {
      expect(src).not.toMatch(/Bearer\s+[A-Za-z0-9_\-]{20,}/);
      expect(src).not.toMatch(/hero_api_key["']?\s*[:=]\s*["'][A-Za-z0-9]{16,}/);
    }
  });
});
