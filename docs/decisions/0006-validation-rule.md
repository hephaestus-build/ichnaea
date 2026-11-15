# 0006 The validation rule, in two stages

- Status: Accepted
- Date: 2026-11-15

## Context

A method is validated by simulation and exact enumeration over a grid. A rule of "within 3 Monte
Carlo standard errors" mixes simulation error with method error: it tightens as repetitions grow,
so no real method passes at 200,000 repetitions. A rule that fails a point only when
coverage + 3·SE < 0.94 at 6,000 repetitions is a tolerance of about 0.018, not 0.01.

## Decision

1. Screen every point at 6,000 repetitions (pull requests) or 10,000 (nightly). A coverage point at
   or above 0.94 + 2·SE passes.
2. Confirm every other point: exactly where enumeration is cheap, otherwise with an independent seed
   until SE ≤ 0.0005.
3. A confirmed coverage point fails if its estimate + 3·SE is below 0.94. An exact point must be at
   least 0.94.
4. Type-I error uses the same two stages. A confirmed point fails if its estimate − 3·SE is above
   0.05. An exact point must be at most 0.05.
5. The grid mean of coverage fails if mean + 3·SE_mean is below 0.95.
6. Every run prints the rule in effect.

## Evidence

- Under the stricter reading, the variant without the N/(N−1) factor fails 157 of 396 points;
  under the lenient one, only 86.
- The test suite pins every threshold at its edge with exact and Bernoulli points, and 13 changes to
  the rule are each detected.

## Consequences

- Coverage grids fail without confirming when more than 12 points are candidates. That is stricter
  than the rule, which confirms every candidate. Type-I grids confirm every candidate.
