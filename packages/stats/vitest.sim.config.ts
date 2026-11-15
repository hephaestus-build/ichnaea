import { defineProject } from "vitest/config";

// Simulation studies of coverage and type-I error. ICHNAEA_SIM_REPS sets the repetitions:
// 2,000 on pull requests, 10,000 nightly.
export default defineProject({
  test: {
    name: "stats-sim",
    include: ["test/**/*.sim.test.ts"],
    testTimeout: 1_800_000,
  },
});
