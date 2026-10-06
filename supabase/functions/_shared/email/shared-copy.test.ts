// Die Mail-App (apps/mail) hat eine KOPIE von types.ts, weil Vercel nur den
// Unterordner baut. Dieser Test merkt, wenn die beiden auseinanderlaufen.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("apps/mail/src/lib/shared.ts", () => {
  it("entspricht types.ts (npm run sync-shared)", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const src = readFileSync(join(root, "supabase/functions/_shared/email/types.ts"), "utf8");
    const copy = readFileSync(join(root, "apps/mail/src/lib/shared.ts"), "utf8");
    expect(copy.endsWith(src)).toBe(true);
    expect(copy.slice(0, copy.length - src.length)).toMatch(/^\/\/ KOPIE von/);
  });
});
