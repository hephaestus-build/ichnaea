// Manual mutation testing of the judge calibration until StrykerJS runs at 1.0 (REQ-112). Each
// mutant is one source change that a test in the `calibration` project must detect. Run in a
// scratch copy, never in a working tree:
//   node scripts/calibration/mutants.ts            # every mutant
//   node scripts/calibration/mutants.ts "judgePass" # selected mutants
// The run, its canary and control, and what counts as a kill are those of scripts/stats/mutants.ts.
import { join } from "node:path";

import { runTests } from "../mutation.ts";
import { type Mutant, runMutants } from "../stats/mutants.ts";

const FILE = "src/calibration/analyze.ts";

/** The canary: a comment change, which no test can detect. It must survive. */
export const CANARY: Mutant = {
  id: "canary: a comment only",
  file: FILE,
  from: "/** Why a judge-based Pass is not reachable. */",
  to: "/** Why a judge-based Pass is not reachable (the mutation canary). */",
};

/** The control: the status inverted, which every calibration test sees. It must be killed. */
export const CONTROL: Mutant = {
  id: "control: calibrated and diagnostic swapped",
  file: FILE,
  from: 'status: calibrated(boot) ? "calibrated" : "diagnostic",',
  to: 'status: calibrated(boot) ? "diagnostic" : "calibrated",',
};

/** One mutant per branch of judgePass. */
export const MUTANTS: readonly Mutant[] = [
  {
    id: "judgePass reports noKnownWorse for levels",
    file: FILE,
    from: 'analysis.statistic === "gwet-ac1" ? "noKnownWorse" : "unsupportedScale",',
    to: '"noKnownWorse",',
  },
  {
    id: "judgePass reports unsupportedScale for yes/no labels",
    file: FILE,
    from: 'analysis.statistic === "gwet-ac1" ? "noKnownWorse" : "unsupportedScale",',
    to: '"unsupportedScale",',
  },
  {
    id: "judgePass leaves out notCalibrated",
    file: FILE,
    from: 'const blockedBy: PassBlocker[] = analysis.status === "calibrated" ? [] : ["notCalibrated"];',
    to: "const blockedBy: PassBlocker[] = [];",
  },
  {
    id: "judgePass inverts dropNotShown",
    file: FILE,
    from: 'if (!slope.dropShown) blockedBy.push("dropNotShown");',
    to: 'if (slope.dropShown) blockedBy.push("dropNotShown");',
  },
  {
    id: "judgePass inverts slopeNotShown",
    file: FILE,
    from: 'if (!(margin > 0)) blockedBy.push("slopeNotShown");',
    to: 'if (margin > 0) blockedBy.push("slopeNotShown");',
  },
  {
    id: "judgePass reports the margin with the wrong sign",
    file: FILE,
    from: "lowerBoundAtLeast: -margin,",
    to: "lowerBoundAtLeast: margin,",
  },
];

// Importing this file runs nothing: only running it mutates the sources.
if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..");
  process.exitCode = runMutants(
    MUTANTS,
    root,
    process.argv.slice(2),
    console.log,
    (name) => runTests(root, ["calibration"], name),
    CANARY,
    CONTROL,
  );
}
