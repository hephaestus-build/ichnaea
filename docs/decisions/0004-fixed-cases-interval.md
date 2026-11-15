# 0004 The fixed-cases interval: stratified Miettinen–Nurminen with equal case weights

- Status: Accepted
- Date: 2026-11-15

## Context

A `fixed-cases` comparison asks whether a candidate is worse than a base on these cases, beyond
run-to-run noise. Each case has a few trials per arm, often 2 or 3, and the counts can differ
between cases and arms.

## Decision

- The estimate is the mean of the per-case differences. Every case has equal weight, whatever its
  trial count.
- The interval is the stratified Miettinen–Nurminen score interval with the N/(N−1) variance factor
  per stratum and no skewness correction.
- The zero-noise floor is minus the lower bound when every trial passes in both arms. With r trials
  in each of n cases it is about z²/(n(r − ½) + z²).

## Evidence

- A study of 252 grid points at 10,000 repetitions and an independent study of 396 points agree.
  Without the N/(N−1) factor, coverage at 2 trials falls to a minimum of 0.916. With it, the
  minimum is 0.945.
- Weighting cases by n1·n2/(n1 + n2) gave −0.60 for two cases whose mean difference is 0. With
  missingness tied to the effect, coverage fell to 0.61–0.82. With equal weights it returned to
  0.96–0.98.
- The implementation matches the R package ratesci to about 1e-11 on 66 edge cases.

## Consequences

- One-sided α = 0.05 floors: 17 cases, 0.096 (2 trials) and 0.060 (3 trials); 60 cases, 0.029 and
  0.018.
- A suite can give some cases more trials. The method handles unequal counts.
