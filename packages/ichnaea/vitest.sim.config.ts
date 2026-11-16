import { defineConfig } from "vitest/config";

import { SIM_PROJECTS } from "./vitest.projects.ts";

export default defineConfig({ test: { projects: SIM_PROJECTS } });
