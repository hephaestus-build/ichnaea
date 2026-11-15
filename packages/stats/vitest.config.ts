import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "stats",
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.sim.test.ts"],
  },
});
