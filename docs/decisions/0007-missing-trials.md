# 0007 Missing trials and the validated domain

- Status: Superseded by 0009
- Date: 2026-11-15

## Context

Trials go missing: infrastructure fails, or a trial is not run. Dropping a case with fewer than 2
completed trials hid real drops. In one example, 60 cases of which 6 lost their only remaining
failing candidate trial gave an estimate of 0.000 and a non-inferiority pass. With those trials
kept, the estimate is −0.10 and the regression p-value is 1.6e-8.

## Decision

- Every completed trial counts. A case with at least one completed trial per arm stays in, with
  equal weight. A case with no completed trial in an arm is excluded and counts against coverage.
- A result is validated only for binary outcomes, at least 5 cases, every case with at least one
  completed trial per arm, at most 5 trials per case and arm, and at least 90% of case-arm cells
  with 2 or more trials.
- `sampled-cases` needs at least 300 cases, one trial per case and arm and one case per family.
  Otherwise it is estimate-only.

## Evidence

- At 3 cases with 2 trials, exact coverage falls to 0.9385. From 5 to 9 cases every exact minimum is
  at least 0.9434.
- A sign-flip test under `sampled-cases` rejected up to 59% of true non-inferiority nulls, so that
  estimand has no small-sample method.

## Consequences

- `validated` assumes that missingness within a case does not depend on the outcome. When it may,
  the decision layer runs a sensitivity analysis.
