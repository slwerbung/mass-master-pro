import { defineConfig } from "vitest/config";

// Unit tests for pure logic (e.g. the booking engine). Kept separate from the
// Playwright e2e suite (`npm test`). Run with `npm run test:unit`.
export default defineConfig({
  test: {
    include: ["supabase/functions/_shared/booking/**/*.test.ts"],
    environment: "node",
  },
});
