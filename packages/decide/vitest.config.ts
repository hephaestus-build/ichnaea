import { defineProject } from "vitest/config";

import { workspaceAlias } from "../../vitest.workspace-alias.ts";

export default defineProject({
  resolve: { alias: workspaceAlias },
  test: {
    name: "decide",
    include: ["test/**/*.test.ts"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
  },
});
