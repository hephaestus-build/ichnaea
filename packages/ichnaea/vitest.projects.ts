// The test projects of the package, one per area of its sources. The package's own vitest configs
// and the repository's root config share them, so that `--project <area>` selects the same tests
// from either place.
import type { TestProjectInlineConfiguration } from "vitest/config";

const root = import.meta.dirname;
const AREAS = ["contracts", "stats", "core", "decide", "report"] as const;

/**
 * The unit suite of each area, and the tests of the mutation harnesses in a project of their own.
 * The simulation studies (`*.sim.test.ts`) are not part of it. A mutant run executes one area's
 * project with the mutant applied, so that project must not hold the harness's own test: its
 * anchor check fails whenever any mutant is applied, which would count every mutant as killed.
 */
export const UNIT_PROJECTS: TestProjectInlineConfiguration[] = [
  ...AREAS.map((area) => ({
    test: {
      name: area,
      root,
      include: [`test/${area}/**/*.test.ts`],
      exclude: [`test/${area}/**/*.sim.test.ts`, `test/${area}/mutants.test.ts`],
      typecheck: { enabled: true, include: [`test/${area}/**/*.test-d.ts`] },
    },
  })),
  { test: { name: "mutants", root, include: ["test/*/mutants.test.ts", "test/mutation.test.ts"] } },
];

/**
 * The simulation studies, too slow for the unit suite. `stats-sim` runs the coverage and type-I
 * error studies under the validation rule (decision 0006): ICHNAEA_SIM_REPS sets the screening
 * repetitions, 6,000 on pull requests and 10,000 nightly, and candidates are confirmed in the same
 * run. `decide-sim` runs the studies of the decision rule. CI runs both in the simulation job.
 */
export const SIM_PROJECTS: TestProjectInlineConfiguration[] = [
  {
    test: {
      name: "stats-sim",
      root,
      include: ["test/stats/**/*.sim.test.ts"],
      testTimeout: 1_800_000,
    },
  },
  {
    test: {
      name: "decide-sim",
      root,
      include: ["test/decide/**/*.sim.test.ts"],
      testTimeout: 600_000,
    },
  },
];
