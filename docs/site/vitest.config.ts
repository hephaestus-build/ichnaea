import { defineProject } from "vitest/config";

// Resolve the Ichnaea package to its TypeScript sources, as the site's build does, so that the
// tests need no build.
const conditions = ["ichnaea-source", "import", "default"];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { name: "docs-site", include: ["test/**/*.test.ts"] },
});
