import { defineProject } from "vitest/config";

// Simulation studies of coverage and type-I error under DC-7. ICHNAEA_SIM_REPS sets the screening
// repetitions: 6,000 on pull requests, 10,000 nightly. Candidates are confirmed in the same run.
export default defineProject({
  test: {
    name: "stats-sim",
    include: ["test/**/*.sim.test.ts"],
    testTimeout: 1_800_000,
  },
});
