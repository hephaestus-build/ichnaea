import { defineProject } from "vitest/config";

export default defineProject({
  // Resolve workspace packages to their TypeScript sources, as tsc does (customConditions).
  resolve: { conditions: ["ichnaea-source", "import", "default"] },
  ssr: { resolve: { conditions: ["ichnaea-source", "import", "default"] } },
  test: {
    name: "stats",
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.sim.test.ts"],
  },
});
