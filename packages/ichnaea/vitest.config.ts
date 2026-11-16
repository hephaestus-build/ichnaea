import { defineConfig } from "vitest/config";

import { UNIT_PROJECTS } from "./vitest.projects.ts";

export default defineConfig({ test: { projects: UNIT_PROJECTS } });
