# 0009 Missing trials, and a validated domain for each result

- Status: Accepted
- Date: 2026-11-15

## Context

Decision 0007 gave a comparison one validity flag, with a domain of at most 5 trials per case and
arm. The two methods that a verdict rests on are checked against different properties. The
regression test must keep its type-I error at or below 0.05, at a difference of 0. The
non-inferiority interval must cover the true difference at the margin, so its validity depends on
the margin. One flag cannot be true for one method and false for the other. The trial cap was also
wider than the studies: the search for heterogeneous effects covers 2, 3 and mixed counts only.

## Decision

- Every completed trial counts. A case with at least one completed trial per arm stays in, with
  equal weight. A case with no completed trial in an arm is excluded and counts against coverage.
- Every `fixed-cases` comparison has two results of the same shape, `{ validated, limitations }`.
  Each result lists every condition that fails.
- `regression` is validated only for binary outcomes, at least 5 cases, no excluded case, at most 3
  completed trials per case and arm, and at least 90% of case-arm cells with 2 or more trials. It
  does not depend on the margin.
- `nonInferiority` needs the same conditions, an established margin floor, and an effective margin
  (the declared margin minus any safety margin) from that floor up to 0.30.
- The margin floor is not set yet. Until it is, no `nonInferiority` result is validated, at any
  margin, and each one gives the reason "the validated margin floor is not set yet". A verdict that
  needs non-inferiority cannot be reached.
- A claim that the candidate is better tests the same interval at a margin of 0, below any floor.
  It stays descriptive and is never validated.
- `sampled-cases` needs at least 300 cases, one trial per case and arm and one case per family.
  Otherwise it is estimate-only. Its results are experimental, so neither result is validated.

This record supersedes decision 0007.

## Evidence

- At 3 cases with 2 trials, exact coverage falls to 0.9385. From 5 to 9 cases every exact minimum on
  the grid is at least 0.9435.
- Exact searches over heterogeneous effects (most cases pass every base trial and drop under the
  candidate, and a few noisy cases offset the drops) found coverage below 0.94 at margins from 0.05
  to 0.185, with 5 to 8 cases and 3 trials in a first search, and at 9 and 10 cases with mixed
  trial counts in a second. The change that sets the floor lists each point.
- A sign-flip test under `sampled-cases` rejected up to 59% of true non-inferiority nulls, so that
  estimand has no small-sample method.

## Consequences

- A comparison can show a regression today, but it cannot show non-inferiority. The change that
  sets the floor brings its search, the search space, the seeds and the structures it skipped.
- Suites that run more than 3 trials per case and arm get no validated result.
- `regression.validated` assumes that missingness within a case does not depend on the outcome.
  When it may, the decision layer runs a sensitivity analysis.
