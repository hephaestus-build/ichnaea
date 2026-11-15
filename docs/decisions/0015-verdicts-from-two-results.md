# 0015 REGRESSION needs the regression result, and no run passes until the margin floor is set

- Status: Accepted
- Date: 2026-11-15

## Context

Decision 0009 gives every comparison two validity results, `regression` and `nonInferiority`, each
with its own validated domain. The regression test does not depend on the margin. The
non-inferiority result needs a validated margin floor, and the floor is not set yet. A verdict
that read one flag for both would either block nothing, because no comparison is validated, or
pass on an interval whose coverage is not shown.

## Decision

- The decision record carries both results, with the names and shape of decision 0009, on every
  comparison and every sensitivity result. There is no unnamed `validated` flag. A result that is
  not validated names at least one limitation, and a validated result names none.
- REGRESSION needs `regression.validated`. The Holm family is the comparisons whose regression
  result is validated.
- NON-INFERIOR, and so PASS, needs both results validated.
- A measure that does not regress and whose non-inferiority result is not validated is
  INCONCLUSIVE, and the reason names why. When the unset floor is the only cause for every primary
  measure, the reason says so in plain words: no measure regressed, but no candidate can PASS yet.
- The sensitivity analysis for missing trials (decision 0010) applies to REGRESSION as before.
- A report labels a lower bound "not validated" whenever its `nonInferiority` result is not
  validated. `regression.validated` never vouches for an interval.

## Evidence

- `packages/decide/test/floor.test.ts` decides a grid of cases, trials, rates, changes and margins
  while the floor is not set: no measure is NON-INFERIOR, and both REGRESSION and INCONCLUSIVE
  occur.
- The false REGRESSION rate stays at or below α with Holm over the regression-validated family:
  0.022 at 2 trials and 0.029 at 3 (`test:sim`).

## Consequences

- Until the floor is set, a decision can block a real drop, but it never passes. An unchanged
  candidate gives INCONCLUSIVE. A suite whose policy blocks on INCONCLUSIVE blocks every change.
- A drop beyond run-to-run noise but inside the margin gives REGRESSION, not NON-INFERIOR, because
  non-inferiority cannot be shown yet.
- The tests of NON-INFERIOR and PASS decide through the same rule with comparisons in which only
  the floor's limitation is removed. No test changes the statistics constant.
- The change that sets the floor revisits the tests that pin the unset floor.
