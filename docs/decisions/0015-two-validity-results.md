# 0015 A comparison has two validity results, and no run passes until the margin floor is set

- Status: Accepted
- Date: 2026-11-15

## Context

A paired comparison gives two results that rest on different evidence:

- The exact regression test. Its type-I error is shown on a domain of cases and trials. That domain
  does not depend on the margin.
- The non-inferiority result: the one-sided lower bound against the margin. Its coverage is shown
  only on the same domain, from a smallest validated margin (the margin floor) up to 0.30.

The margin floor is not set yet: a search found coverage below the bar at margins from 0.05 to
0.185 (`packages/stats/VALIDATION.md`). With one validity flag for both results, every comparison
is then not validated. That would make REGRESSION impossible too, although the regression test
does not depend on the margin. A single unnamed flag beside an interval also reads as if it covered
the interval.

## Decision

- Every comparison carries two results of the same shape, `regression` and `nonInferiority`, each
  `{ validated, limitations }`. There is no unnamed `validated` flag. A result that is not
  validated names at least one limitation, and a validated result names none. Sensitivity results
  carry both too.
- `regression` is validated on the domain where the exact test's type-I error is shown: binary
  outcomes, at least 5 cases, a completed trial per arm in every case, at most 3 trials per case
  and arm, and replicate patterns inside the studied grid.
- `nonInferiority` needs the same domain, an established margin floor, and an effective margin from
  the floor up to 0.30.
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

- The regression test's type-I error and the coverage failures below the floor are in
  `packages/stats/VALIDATION.md`.
- `packages/decide/test/floor.test.ts` decides a grid of cases, trials, rates, changes and margins
  while the floor is not set: no measure is NON-INFERIOR, and both REGRESSION and INCONCLUSIVE
  occur.

## Consequences

- Until the floor is set, a decision can block a real drop, but it never passes. An unchanged
  candidate gives INCONCLUSIVE. A suite whose policy blocks on INCONCLUSIVE blocks every change.
- A drop beyond run-to-run noise but inside the margin gives REGRESSION, not NON-INFERIOR, because
  non-inferiority cannot be shown yet.
- The tests of NON-INFERIOR and PASS decide through the same rule with comparisons in which only
  the floor's limitation is removed. No test changes the statistics constant.
- The change that sets the floor makes `nonInferiority` validated on its validated domain only, and
  revisits the tests that pin the unset floor.
