import { defineProject } from "vitest/config";

import { workspaceAlias } from "../../vitest.workspace-alias.ts";

export default defineProject({
  resolve: { alias: workspaceAlias },
  test: {
    name: "decide",
    include: ["test/**/*.test.ts"],
    // Each decision simulates its minimum detectable effect (1,000 runs per primary measure), so a
    // test that decides several 60-case runs can pass 5 seconds when the whole workspace runs at once.
    testTimeout: 60_000,
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
  },
});
