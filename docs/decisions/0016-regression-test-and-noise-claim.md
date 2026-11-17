# 0016 The regression test, and when a verdict may claim run-to-run noise

- Status: Accepted
- Date: 2026-11-15

## Context

Decision 0005 chose the regression test. Its context said: "REGRESSION means the candidate dropped
beyond run-to-run noise." That sentence is not true for every REGRESSION. A comparison can be
validated for regression when up to 10% of its case-arm cells have only 1 trial (decision 0009).

A hosted model rarely honours a seed, so the same case can pass in one run and fail in the next.
With 2 or more trials of a case in an arm, the records show how much that case varies between runs,
and the stratified test compares the drop with that variation inside the case. With 1 trial, a case
shows one outcome per arm. A pair that passes in the base and fails in the candidate is what a real
drop gives. It is also what an unchanged case with a pass rate between 0 and 1 gives. The records of
that case cannot tell the two apart. The test can still find the drop significant on these cases,
but the drop is not shown to be beyond run-to-run noise.

Decision 0011 already limits the noise clause of the scope sentence to cases with 2 trials in each
arm. The REGRESSION reason and the note on a NON-INFERIOR measure did not follow that rule.

## Decision

- A verdict says "beyond run-to-run noise" only when the comparison is `fixed-cases` and every case
  that the primary measures compare has at least 2 completed trials in each arm. A missing trial
  does not count. This applies to:
  - the scope sentence, which adds ", beyond run-to-run noise";
  - the REGRESSION reason, which reads "Measure X dropped beyond run-to-run noise and is not shown
    non-inferior.";
  - the note on a NON-INFERIOR measure whose drop is significant, which reads "a drop smaller than
    the margin is beyond run-to-run noise".
- Otherwise the REGRESSION reason reads "Measure X dropped and is not shown non-inferior.", and the
  note reads "a drop smaller than the margin is significant". The scope sentence names the cases
  only.
- The regression test does not change:
  - With equal trial counts, it is the exact stratified conditional test. Cases where every trial
    agrees drop out.
  - With unequal trial counts, it is a within-case permutation test with a seeded generator.
  - The score test at a difference of 0 is not a regression test. It stays the non-inferiority
    test, which is judged by coverage at the margin.
- The test behind REGRESSION keeps its type-I error at or below α = 0.05 on every validated
  pattern.

This record supersedes decision 0005.

## Evidence

- `packages/decide/src/decide.ts`: `replicated` holds when some case is compared and every compared
  case has at least 2 trials in each arm. `beyondNoise` adds the `fixed-cases` condition. The scope
  sentence (`scopeOf`) and the REGRESSION reason both read `beyondNoise`, so they cannot disagree.
  The note on a NON-INFERIOR measure reads `replicated`. A NON-INFERIOR result exists only under
  `fixed-cases`, because no `sampled-cases` result is validated (decision 0009).
- `packages/decide/test/verdict.test.ts` pins the rule:
  - "'beyond run-to-run noise' only with at least 2 trials per case and arm": 60 cases with 3
    trials give the clause. When one case keeps 1 candidate trial, the scope drops it.
  - "the REGRESSION reason claims run-to-run noise only where the scope does": 60 cases, 3 trials,
    base 0.95, candidate 0.8, margin 0.05. When case-003 loses 2 of its 3 candidate trials, the
    verdict stays REGRESSION, and neither the scope nor the reason claims noise.
  - "estimate-only and INVALID decisions make no claim beyond run-to-run noise".
- `packages/decide/test/decide.test.ts`, "the note on a drop inside the margin claims run-to-run
  noise only with 2 trials per case and arm": the same drop with one case left at 1 trial gives "is
  significant".
- `packages/report/test/report.test.ts`, "a REGRESSION headline claims no run-to-run noise when a
  case has fewer than 2 trials in an arm": neither the Markdown nor the HTML report claims it.
- `packages/decide/scripts/mutants.ts` has four mutants that the tests kill: "scope always claims
  run-to-run noise", "noise claimed without 2 trials per case and arm", "the regression reason
  always claims noise" and "the non-inferiority note always claims noise".
- The regression test, as decision 0005 found:
  - The exact test matches R's exact Mantel–Haenszel test to about 1e-13. Its worst type-I error,
    computed exactly over 5–9, 17 and 60 cases with 2 and 3 trials, is 0.0407.
  - The score test at 0 exceeds 0.05. Exactly: 0.0525 at 17 cases with 2 trials (12 cases at rate
    1, 3 at 0.8, 2 at 0.3), and 0.0559 at 5 cases with 5 trials and rate 0.1. By simulation:
    0.0561 ± 0.0005 at 17 cases, 5 trials, rate 0.97. The test suite computes the first value and
    requires the validation rule to fail it.

## Consequences

- A REGRESSION on a run where a compared case has 1 trial in an arm still blocks. Its reason and
  scope state the weaker claim: the drop is significant on these cases.
- A suite that wants the noise claim runs at least 2 trials per case and arm and keeps them.
- Every test that can give REGRESSION is held to the type-I rule of decision 0006.

## Note (2026-11-16): where the cited files are now

The merge into one package (#35) moved the files that this decision cites. The decision is unchanged. The files are now:

- `packages/decide/scripts/mutants.ts` is `packages/ichnaea/scripts/decide/mutants.ts`.
- `packages/decide/src/decide.ts` is `packages/ichnaea/src/decide/decide.ts`.
- `packages/decide/test/decide.test.ts` is `packages/ichnaea/test/decide/decide.test.ts`.
- `packages/decide/test/verdict.test.ts` is `packages/ichnaea/test/decide/verdict.test.ts`.
- `packages/report/test/report.test.ts` is `packages/ichnaea/test/report/report.test.ts`.

The mutants it names run in `.github/workflows/mutants.yml`, so the claim that the tests kill them rests on that workflow's latest green run on main.
