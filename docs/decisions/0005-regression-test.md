# 0005 The regression test is the exact stratified conditional test

- Status: Accepted
- Date: 2026-11-15

## Context

REGRESSION means the candidate dropped beyond run-to-run noise. The test behind it must keep its
type-I error at or below α = 0.05 on every validated pattern.

## Decision

- With equal trial counts, the regression test is the exact stratified conditional test. Cases
  where every trial agrees drop out.
- With unequal trial counts, it is a within-case permutation test with a seeded generator.
- The score test at a difference of 0 is not a regression test. It stays the non-inferiority test,
  which is judged by coverage at the margin.

## Evidence

- The exact test matches R's exact Mantel–Haenszel test to about 1e-13. Its worst type-I error,
  computed exactly over 5–9, 17 and 60 cases with 2 and 3 trials, is 0.0407.
- The score test at 0 exceeds 0.05. Exactly: 0.0525 at 17 cases with 2 trials (12 cases at rate 1,
  3 at 0.8, 2 at 0.3), and 0.0559 at 5 cases with 5 trials and rate 0.1. By simulation:
  0.0561 ± 0.0005 at 17 cases, 5 trials, rate 0.97. The test suite computes the first value and
  requires the validation rule to fail it.

## Consequences

- Every test that can give REGRESSION is held to the type-I rule of decision 0006.
