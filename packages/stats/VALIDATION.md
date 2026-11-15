# Statistics validation

This page records the evidence behind each method in `@hephaestus-build/ichnaea-stats`: agreement
with an independent implementation, exact computation where it is cheap, and simulation studies of
coverage and type-I error.

## The bar

A grid point passes when its coverage is at least nominal − 0.01, read with its Monte Carlo error:
a point fails when even its upper bound (coverage + 3 standard errors) is below nominal − 0.01. The
mean over the grid must not be below nominal. Simulated points use at least 6,000 repetitions, so
the standard error at 95% is at most 0.003. Points computed exactly have no Monte Carlo error.
Every run prints its table, passing or not.

## Reference values

`test/reference-ratesci.json` comes from the R package ratesci 1.1.1 and R's `mantelhaen.test`
(`scripts/reference.R`, run in a container as a test-only oracle). Ichnaea agrees with:

| Set                                                                                                                                                         | Size | Tolerance     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| Wilson intervals                                                                                                                                            | 22   | 1e-6          |
| Miettinen–Nurminen, Mee and skewness-corrected differences, one stratum                                                                                     | 88   | 1e-6          |
| Stratified differences, Mantel–Haenszel weights                                                                                                             | 48   | 1e-6          |
| Stratified differences, equal case weights (equal and unequal replicates)                                                                                   | 16   | 1e-6          |
| Tango paired intervals, plain and skewness-corrected, every table with n = 10 and n = 25                                                                    | 834  | 1e-6          |
| Non-inferiority p-values (ratesci's score test at −margin) and regression p-values (exact Mantel–Haenszel) through `compareCounts`, with the reported bound | 16   | 1e-6 and 1e-9 |

## fixed-cases: the estimate and its interval

The estimand is the mean of the per-case differences. Every case has the same weight, whatever its
replicate count. Mantel–Haenszel weights (n1·n2/(n1+n2)) give another estimand as soon as replicate
counts differ, which happens whenever trials are missing. Two cases whose differences average 0 then
give −0.60, and missingness tied to the drop lowers coverage to 0.61–0.82 (independent review,
20,000 repetitions). With equal weights the same scenarios cover at 0.959–0.982, and nothing changes
when every case has the same counts, because then the two weightings agree. `test/decision-values`
pins the two-case example.

The interval is the stratified Miettinen–Nurminen score interval with the N/(N−1) factor and no
skewness correction (design change DC-2). A 252-point study at 10,000 repetitions
(`scripts/study-fixed-cases.ts`, `validation/fixed-cases.json`; run it once per case count with
`STUDY_K` and `STUDY_R`, which is how the committed file was produced) chose it:

| Variant                             | Minimum coverage | Mean coverage | Points below the band |
| ----------------------------------- | ---------------- | ------------- | --------------------- |
| Miettinen–Nurminen (N/(N−1) factor) | 0.9424           | 0.9605        | 1                     |
| Mee (no factor)                     | 0.9164           | 0.9462        | 154                   |
| Skewness-corrected, no factor       | 0.8819           | 0.9432        | 166                   |
| Skewness-corrected with the factor  | 0.9207           | 0.9598        | 2                     |

The study used Mantel–Haenszel weights, which equal equal weights there (every case had the same
counts). 19 of its points are degenerate (coverage at least 0.999); without them the mean of the
chosen variant is 0.959. Without the factor the interval undercovers when each case has only 2 or 3
trials per arm: per-stratum nuisance estimates are biased in sparse strata, and the factor corrects
about that amount.

The one point below the band is at a true difference of 0: 17 cases, 5 replicates, every case at
0.97. Two confirmation runs give 0.9435 and 0.9443 (each ± 0.0005, 200,000 repetitions). The deficit
is real but inside DC-5's tolerance. It concerns a superiority claim at a true difference of 0, not
the non-inferiority test. A superiority claim (REQ-119) needs a method that meets the bar there.

Few cases, computed exactly (`scripts/exact-coverage.ts`, all cases at one rate, rates 0.5 to 0.95,
true differences 0 to −0.2):

| Cases | r = 2  | r = 3  |
| ----- | ------ | ------ |
| 1     | 0.9375 | 0.9127 |
| 2     | 0.9492 | 0.9427 |
| 3     | 0.9461 | 0.9411 |
| 4     | 0.9422 | 0.9454 |
| 5     | 0.9455 | 0.9472 |
| 6     | 0.9471 | 0.9489 |

One case fails the bar. From 3 cases on, every point passes.

## The validated domain

`compareCounts` returns `validated: true` only where the evidence covers the call: `fixed-cases`,
binary values, the same replicate count for every case and arm, and at least 3 cases. Outside it
(unequal replicates, proportions of several items per trial, fewer cases, or any `sampled-cases`
method) it returns `validated: false`, and a decision built on the result states that as a
limitation.

## fixed-cases: the regression test

When every case has the same counts and binary values, the regression test (H0: no drop) is the
exact stratified conditional test: Fisher's exact test per case, combined by convolution. It equals
R's exact Mantel–Haenszel test (`mantelhaen.test(exact = TRUE)`). It is exact under the sharp null
and conservative: in the study its type-I error with no change has a maximum of 0.0427 and a mean of
0.0228, and heterogeneous nulls with mean zero stay conservative. The Miettinen–Nurminen score test
at 0 reaches 0.058 (independent review), above the bar, so it is not used (DC-4).

With unequal counts the regression test is a within-case permutation test of the equal-weight mean
difference, by Monte Carlo with the seeded generator (not yet validated).

## Floors and the minimum detectable effect

The zero-noise floor, the smallest margin that can pass when every trial passes in both arms, is

floor = z² / (K(r − ½) + z²), z = 1.645 (one-sided α = 0.05),

for K cases with r replicates each. It depends on K(r − ½), not on the total number of trials, so
for a fixed number of trials more replicates per case lower it. The approximation z²/(K·r + z²)
belongs to the variant without the factor:

| Cases | Floor, r = 2 | Floor, r = 3 | z²/(K·r + z²), r = 2 |
| ----- | ------------ | ------------ | -------------------- |
| 17    | 0.096        | 0.060        | 0.074                |
| 20    | 0.083        | 0.051        | 0.063                |
| 52    | 0.034        | 0.020        | 0.025                |
| 60    | 0.029        | 0.018        | 0.022                |
| 250   | 0.007        | 0.004        | 0.005                |

`scripts/floors.ts` prints this table, and a test pins the closed form. `fixedCasesMde` simulates the
method itself: the power quantile (nearest rank) of the margins that pass when both arms share the
observed per-case rates. A test replays it independently.

## CI gate

`test/coverage.sim.test.ts` runs on every pull request with 6,000 repetitions and nightly with
10,000:

- the lower bound: 54 exact points (3 to 5 cases) and 60 simulated points (17 and 60 cases;
  r = 2, 3, 5; rates 0.7, 0.9, 0.97, a mixture of stable and noisy cases, and low rates from 0.03
  to 0.3; true differences 0 and −0.05), plus heterogeneous effects, unequal replicates, and
  missingness tied to the drop;
- the regression test's type-I error on 24 null points;
- two checks of the check: a lower bound shifted up by 2 points fails, and the variant without the
  factor fails.

Seeds 1–999 serve coverage points, 1000–1999 type-I points, and 9000 and above the checks of the
check, so no two experiments share a stream.

## Not yet validated to the bar

| Method                                              | Use                                                                          | Measured                                                                                                                                                                                                                                               | Status                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Tango paired score interval, skewness-corrected     | `sampled-cases`, one trial per case, one case per family, at least 300 cases | Agrees with ratesci on every table with n = 10 and 25. Simulated minimum 0.936, mean 0.960 over 40 points (`validation/tango.tsv`, before the cancellation fix); below the band at 15 cases with heavy discordance and with a structurally empty cell. | Experimental. Below 300 cases it is not used.                                    |
| Sign-flip randomisation on family differences       | `sampled-cases` otherwise: the regression test only                          | Valid for H0: no difference. For shifted nulls with binary differences it rejects far too often (independent review: up to 34.5% at a nominal 5%), so it never tests non-inferiority. With 4 or fewer families it cannot reject at 5%.                 | Experimental, regression test only. Non-inferiority is never shown on this path. |
| Within-case permutation                             | `fixed-cases` regression test with unequal counts                            | Exact under the sharp null by construction; not simulated                                                                                                                                                                                              | Experimental                                                                     |
| Stratified score interval on items inside one trial | `fixed-cases` proportion measures (several items per output)                 | Items of one output are treated as independent trials; they are correlated, so the interval may be too narrow                                                                                                                                          | Not validated                                                                    |
| Wilson interval for one proportion                  | Per-arm rates in reports, never in a decision                                | Exact two-sided coverage at n = 20 is 0.9245 at p = 0.95 and has a minimum of 0.838 near p = 0.009 (`scripts/exact-wilson.ts`); at n = 60 the minimum is 0.840 near p = 0.003                                                                          | Descriptive only                                                                 |

The false-alarm part of REQ-58 (monitor statistics) belongs to the drift canary (step 7).
