import { defineConfig } from "vitest/config";

import { UNIT_PROJECTS } from "./packages/ichnaea/vitest.projects.ts";

export default defineConfig({
  test: {
    projects: [...UNIT_PROJECTS, "examples/*", "scripts"],
  },
});
