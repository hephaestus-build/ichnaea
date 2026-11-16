import { defineProject } from "vitest/config";

// Resolve the Ichnaea package to its TypeScript sources, as tsc does (customConditions), so that the
// tests need no build.
const conditions = ["ichnaea-source", "import", "default"];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { name: "example-support-assistant", include: ["test/**/*.test.ts"] },
});
