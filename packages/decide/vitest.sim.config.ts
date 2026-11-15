import { defineProject } from "vitest/config";

import { workspaceAlias } from "../../vitest.workspace-alias.ts";

// Simulation studies of the decision rule, too slow for the unit suite. CI runs them in the
// simulation job.
export default defineProject({
  resolve: { alias: workspaceAlias },
  test: {
    name: "decide-sim",
    include: ["test/**/*.sim.test.ts"],
    testTimeout: 600_000,
  },
});
