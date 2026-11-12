import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for pure logic (e.g. the booking engine). Kept separate from the
// Playwright e2e suite (`npm test`). Run with `npm run test:unit`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    include: [
      "supabase/functions/_shared/booking/**/*.test.ts",
      "supabase/functions/_shared/email/**/*.test.ts",
      "supabase/functions/email-*/**/*.test.ts",
      "supabase/functions/project-team/**/*.test.ts",
      "supabase/functions/_shared/projects/**/*.test.ts",
      "supabase/functions/_shared/publicLinks.test.ts",
      "supabase/functions/_shared/markup.test.ts",
      "supabase/functions/_shared/markupPdf.test.ts",
      "supabase/functions/_shared/newVersionMail.test.ts",
      "supabase/functions/_shared/archive.test.ts",
      "src/components/review/**/*.test.ts",
      "src/lib/**/*.test.ts",
    ],
    environment: "node",
  },
});
