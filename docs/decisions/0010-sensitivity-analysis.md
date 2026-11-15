# 0010 The sensitivity analysis runs whenever a trial is missing

- Status: Accepted
- Date: 2026-11-15

## Context

A validated comparison assumes that missingness within a case does not depend on the outcome
(decision 0007). That cannot be checked from the records. Missing trials can hide a drop: a
candidate's lost trials may be the trials that failed.

Comparing only the counts of missing trials between the arms misses this. In one fixture, each of
60 cases has 3 trials per arm. The base passes every trial. In 6 cases the candidate fails 2 of 3
trials, and exactly those trials are lost. Twelve passing base trials of other cases are lost too,
so each arm misses 12. When the analysis ran only on differing counts, it was skipped, and the
fixture passed. Without the base losses it ended INCONCLUSIVE.

## Decision

- A trial is missing when it is an infrastructure failure, including a capture failure, a trial not
  run, an invalid configuration, or a trial without a value. A system failure or a budget overrun
  is a failed trial, never a missing one.
- The sensitivity analysis runs whenever a primary measure has a missing trial in either arm,
  whatever the counts.
- Each verdict is tested against the imputation that works against it:
  - Against non-inferiority, and so against PASS, missing candidate trials fail and missing base
    trials pass.
  - Against REGRESSION, missing candidate trials pass and missing base trials fail.
- Both imputations decide every primary measure again with the same rule, Holm included. A
  NON-INFERIOR or REGRESSION verdict that its imputation changes becomes INCONCLUSIVE. An
  INCONCLUSIVE verdict stays INCONCLUSIVE.
- The decision record holds both imputations for each primary measure: the difference with its
  bound, the p-values, whether it is validated, the verdict, and whether it changes the verdict.
  The report shows them next to the observed result.

## Evidence

- The fixture above ends INCONCLUSIVE. Imputed against non-inferiority, it is a REGRESSION.
- In the reverse case, 10 of 60 cases lose 1 of 3 base trials, and the candidate fails 1 of 3
  trials in exactly those cases. The observed comparison is a REGRESSION (regression p = 0.0055).
  Imputing the missing base trials as failures makes the arms equal there, so the verdict is
  INCONCLUSIVE.

## Consequences

- A run with missing trials reaches PASS or REGRESSION only when the verdict survives the worst
  case for it. Missing trials cost verdicts, which is what an analysis that cannot see the lost
  outcomes should do.
- Each primary measure is compared three times instead of once when a trial is missing.
