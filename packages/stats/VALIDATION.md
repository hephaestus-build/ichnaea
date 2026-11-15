# Statistics validation

This page records the evidence behind each method in `@hephaestus-build/ichnaea-stats`: agreement
with an independent implementation, exact computation where it is cheap, and simulation studies of
coverage and type-I error. No verdict may rest on a method or a call outside the validated domain
(decision 0008). Each rule is stated here; `docs/decisions/` records why it was chosen.

## The bar (decision 0006)

Coverage of a 95% one-sided bound and type-I error of a 5% test are checked per grid point in two
stages:

1. **Screen** every point at 6,000 repetitions (pull requests) or 10,000 (nightly). A coverage point
   passes at ≥ 0.94 + 2·SE; a type-I point passes at ≤ 0.05 − 2·SE.
2. **Confirm** every other point (a candidate) with an independent seed until its standard error is
   at most 0.0005 (about 200,000 repetitions), in the same run. A confirmed coverage point fails if
   its estimate + 3·SE is below 0.94; a confirmed type-I point fails if its estimate − 3·SE is above
   0.05. A point computed exactly must be at least 0.94 (coverage) or at most 0.05 (type-I).

The grid mean of coverage fails if mean + 3·SE is below 0.95. A coverage grid with more than 12
candidates fails without confirming them: the interval misses the bar broadly. That is stricter than
the rule, which confirms every candidate. A type-I grid confirms every candidate, because a valid
test whose size is just under 0.05 makes most points candidates. Every run prints its table and the
thresholds in effect (`test:sim` runs Vitest with `--silent=false`, so CI logs show them).

`test/validation-rule.test.ts` pins every threshold at its edge with exact points and Bernoulli
experiments of known rate, in the unit suite: exact 0.9399 and 0.94 − 1e-9 fail and 0.94 passes; a
true 0.936 and 0.937 fail and 0.9395 passes after confirmation; a grid mean of 0.945 fails; nine
screened points at 0.9465 fail on the grid mean (3·SE of the mean, the SEs added in quadrature) and
nine at 0.949 pass; exact type-I 0.0501 fails; a true 0.0527 fails and 0.0505 passes; confirmation
uses the seed plus 100,000.
`scripts/mutants.ts` changes each threshold, the confirmation and the cap, 16 changes in all, and
the unit suite detects each one.

## Reference values

`test/reference-ratesci.json` comes from the R package ratesci 1.1.1 and R's `mantelhaen.test`
(`scripts/reference.R`, run in a container as a test-only oracle). Ichnaea agrees with:

| Set                                                                                                                                                         | Size | Tolerance     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| Wilson intervals                                                                                                                                            | 22   | 1e-6          |
| Miettinen–Nurminen, Mee and skewness-corrected differences, one stratum                                                                                     | 88   | 1e-6          |
| Stratified differences, Mantel–Haenszel weights                                                                                                             | 48   | 1e-6          |
| Stratified differences, equal case weights (equal and unequal trial counts)                                                                                 | 16   | 1e-6          |
| Tango paired intervals, plain and skewness-corrected, every table with n = 10 and n = 25                                                                    | 834  | 1e-6          |
| Non-inferiority p-values (ratesci's score test at −margin) and regression p-values (exact Mantel–Haenszel) through `compareCounts`, with the reported bound | 16   | 1e-6 and 1e-9 |

### The generator and the normal functions

The package has no runtime dependency. Its generator and its normal functions are its own, and
each is pinned against an independent implementation:

- `test/reference-numpy-mt19937.json` comes from numpy 2.3.4 (`scripts/reference-mt19937.py`):
  `MT19937` with legacy integer seeding, for seeds 1, 42, 5489, 2026 and 2^32 − 1. Ichnaea gives
  the same 1,300 raw 32-bit outputs per seed (two state regenerations) and the same 700
  `random_sample` doubles, bit for bit. The old library gave the same sequence, so every seeded
  stream is unchanged. Values derived through the normal functions are not bit for bit the same:
  the old library's `pnorm` and `qnorm` differed from R's in the last digits, so critical values,
  bounds, p-values and the simulated MDE can move by a few units in the last place. For example,
  `critical(0.9, "two")` was 1.6448536269514724 and is now 1.6448536269514715.
- `src/normal.ts` uses the same algorithms as R 4.5.2: Cody for `pnorm` and AS 241 for `qnorm`,
  with R's tail bounds (−38.4674 and 8.2924) and R's asymptotic expansion for subnormal p.
  `test/reference-normal-coefficients.json` holds every coefficient and branch bound of
  `src/normal-coefficients.ts` as printed in R's source at the tag R-4-5-2
  (`scripts/reference-normal-coefficients.ts`), and a test requires the code to use exactly those
  values. This check is needed because a wrong literal can stay inside every accuracy bound: moving
  qnorm's central bound from 0.425 to 0.42 costs at most 2.8 ε·|v|. A wrong digit in a coefficient
  can be invisible in every output: a review found `5226.495278852546` for R's
  `5226.4952788528545610`, a change of about 1e-19 relative, which no reference value detects.
- `test/reference-mpmath-normal.json` holds the true values, from mpmath 1.3.0 at 60 digits and
  rounded to the nearest double (`scripts/reference-normal-mpmath.py`). It has `pnorm` at 13,052
  points from −40 to 10 and `qnorm` at 3,930 probabilities from 5e-324 to 1 − 1e-16: a regular
  grid, small |x| down to 1e-12, extra points on both sides of every branch boundary and beyond
  R's tail bounds, and 9,000 seeded random points across the branch regions. Errors are stated in
  ε·|v| (ε = 2^-52, so 1 ε·|v| is between 1 and 2 units in the last place). Ichnaea is within
  2.5 ε·|v| for `pnorm` with |x| ≤ 1 and within 4 elsewhere, plus 4 subnormal steps near the
  bottom of the double range. The worst measured errors are 2.16 and 2.98 for `pnorm`, 2.82 for
  `qnorm`, and one subnormal step.
- `test/reference-r-normal.json` comes from R 4.5.2 (`scripts/reference-normal.R`): `pnorm` at 356
  points from −39 to 38 and `qnorm` at 326 probabilities, 182 of them subnormal. Ichnaea follows
  R's order of operations, so only the libm functions differ: it equals R exactly at 339 and 325
  of those points and is within 2 ε·|v| everywhere (worst 1.39 and 1.72). For subnormal p it is
  within 1 ε·|v|. Below −38.4674 R returns 0 where the correctly rounded value is the smallest
  subnormal double; Ichnaea follows R. The library used before was up to 774 ε·|v| from R.
- The oracles run on linux/amd64, in images pinned by digest, with hash-pinned Python packages.
  R on arm64 gives slightly different last digits. Each committed reference file is the oracle's
  output byte for byte: the formatter skips them, and the `stats oracle` CI job reruns every oracle
  and fails if a file changes. The ratesci values come from an R package build and are not rerun.

Property tests add that both functions never decrease by more than 4 ε·|v| (rounding makes
neighbouring doubles wobble by up to 2.4 ε·|v|), and that `qnorm(pnorm(x)) = x` at or below the
median, where p keeps its full relative precision.

`scripts/mutants.ts` changes coefficients, every branch bound and cutoff, the tail bounds and the
generator: 49 mutants of the statistics, and the tests detect every one. One change is not detectable: a change to the fifth-order
term of the subnormal expansion moves the result by at most 0.84 ε·|v|. That is below rounding.

## fixed-cases: what counts

`compareCounts` takes binary outcomes: per case and arm, the completed trials that passed, of all
completed trials. Every completed trial counts (decision 0009). A case with at least one completed
trial in each arm enters the analysis with equal weight; a case with none in an arm is excluded,
reported in `excludedCases`, and counts against coverage in the decision. Dropping cases with fewer
than two trials, as an earlier version did, hid a regression: losing 6 of 60 cases' remaining
failing candidate trials turned a −0.10 drop (regression p = 1.6e-8) into a pass.

A validated result assumes that missingness within a case does not depend on the outcome. When the
failing trials of a case go missing, the estimate moves towards a pass: 6 of 60 cases that lose their
2 failing candidate trials of 3 give an estimate of 0.000 instead of −0.067. The decision layer
therefore runs a sensitivity analysis whenever a trial is missing.

Proportion measures (several items in one output), score and ordinal measures have no validated
method yet (decision 0008). `compareCounts` takes the measure's value type and refuses anything but
`binary` with an `EstimandError`, so the measure is estimate-only. Passing a proportion's items as
trials would undercover: with 17 cases and items sharing a latent pass (correlation 0.5 to 0.8),
coverage fell to 0.77–0.93, all marked validated. The method for these measures reduces each trial
to one value and analyses it as a score outcome. It lands before the first suite that declares such a
primary measure, and at the latest for 1.0.

## fixed-cases: the estimate and its interval

The estimand is the mean of the per-case differences, every case with the same weight whatever its
trial count (decision 0004). Mantel–Haenszel weights (n1·n2/(n1+n2)) give another estimand as soon as trial
counts differ. `test/decision-values` pins a two-case example.

The interval is the stratified Miettinen–Nurminen score interval with the N/(N−1) factor and no
skewness correction (decision 0004), chosen by a 252-point study at 10,000 repetitions
(`scripts/study-fixed-cases.ts`, `validation/fixed-cases.json`):

| Variant                             | Minimum coverage | Mean coverage | Points below the band |
| ----------------------------------- | ---------------- | ------------- | --------------------- |
| Miettinen–Nurminen (N/(N−1) factor) | 0.9424           | 0.9605        | 1                     |
| Mee (no factor)                     | 0.9164           | 0.9462        | 154                   |
| Skewness-corrected, no factor       | 0.8819           | 0.9432        | 166                   |
| Skewness-corrected with the factor  | 0.9207           | 0.9598        | 2                     |

## The validated domain (decision 0009)

Every `fixed-cases` comparison has two results of the same shape, `{ validated, limitations }`.
`regression` covers the regression test: it is validated only when every condition below holds,
and it does not depend on the margin. `nonInferiority` covers the interval against the margin: it
needs the same conditions, an established margin floor and a margin inside the range below. Each
result lists every condition that fails in its `limitations`.

- at least 5 cases with a completed trial in each arm (at 3 and 4 cases with 2 trials, exact
  coverage dips to 0.9385 and 0.9394 on a wide grid; with equal trial counts, at 5 to 9, 12 and 13
  cases, every exact point of the CI grid is at least 0.9435; its exact points with one-trial cells
  or mixed counts are at least 0.9431, at 5 cases with 2 candidate trials against 5 base trials,
  outside the cap);
- no excluded case;
- at most 3 completed trials per case and arm. Suites run 2 or 3, and the search for heterogeneous
  effects covers 2, 3 and mixed counts;
- at least 90% of case-arm cells with 2 or more completed trials (one trial per case and arm by
  design is not studied; missingness that leaves some cells with one trial is).

- for `nonInferiority` only: an established margin floor, and an effective margin (the declared
  margin minus any safety margin) from that floor up to 0.30, the validated margin ceiling. A
  declared 0.10 with a safety margin of 0.06 is tested at 0.04. The range covers only this
  `fixed-cases` interval; every other method states its own validated domain. A margin of 0 is not
  a non-inferiority test. A claim that the candidate is better (a lower bound above 0) tests the
  interval at a margin of 0, below any floor, so it stays descriptive and is never validated. A
  unit test checks this on random inputs at every margin below the floor.

**No non-inferiority result is validated: the margin floor is not set yet.** Every
`nonInferiority` result is `validated: false` with the reason "the validated margin floor is not
set yet", at every margin. A unit test checks this for every margin from 0.05 to 0.30 in steps of
0.005. `regression` is unaffected. `VALIDATED_MARGIN_FLOOR` (0.05) is a placeholder that bounds the
margins a plan may declare.

The floor is pending because the lower bound can undercover when most cases pass every base trial
and drop under the candidate while a few noisy cases offset the drops. A first exact search over
such structures, at a true difference of minus the margin, found these points below 0.94:

| Margin | Exact coverage | Cases | Trials per case and arm |
| ------ | -------------- | ----- | ----------------------- |
| 0.050  | 0.93782        | 8     | 3                       |
| 0.055  | 0.93712        | 7     | 3                       |
| 0.060  | 0.93505        | 6     | 3                       |
| 0.070  | 0.93667        | 5     | 3                       |
| 0.155  | 0.93904        | 5     | 3                       |
| 0.185  | 0.93997        | 5     | 3                       |

The change that sets the floor brings the search, its space, its seeds and the structures it
skipped, and makes `nonInferiority` validated only where the search found no failure.

Unequal binary trial counts are inside the domain, but one pattern of them misses the bar: every
case with 2 trials in one arm and 3 in the other. At a true difference of 0 the lower bound lies too
high. The worst exact coverage over the rates and shifts of the CI grid
(`scripts/exact-coverage.ts`), and two confirmed points at 17 cases:

| Cases | Candidate 3 trials, base 2      | Candidate 2 trials, base 3      |
| ----- | ------------------------------- | ------------------------------- |
| 5     | **0.9381** (rate 0.9)           | 0.9452                          |
| 6     | **0.9374** (rate 0.9)           | 0.9448                          |
| 7     | **0.9383** (rate 0.9)           | 0.9456                          |
| 8     | **0.9397** (rate 0.9)           | 0.9413                          |
| 9     | 0.9408                          | **0.9384** (rate 0.05)          |
| 10    | 0.9415                          | **0.9366** (rate 0.05)          |
| 17    | **0.9361 ± 0.0005** (rate 0.95) | **0.9370 ± 0.0005** (rate 0.05) |

The CI gate leaves this pattern out. A second study in `test/coverage.sim.test.ts` requires six of
these points to fail, so a change that makes them pass shows, and the pattern then moves into the
gate. No validated result rests on the pattern today: no `nonInferiority` result is validated, and
the regression test for unequal counts is the permutation test, whose type-I error does not depend
on this bound. The change that sets the floor must take the pattern out of `nonInferiority`, or fix
the interval.

`sampled-cases` results are never validated (see below). `sampled-cases` needs at least 300 cases,
one trial per case and arm and one case per family, so it needs as many families as cases.

## fixed-cases: the regression tests

- **Equal trial counts in every case and arm:** the exact stratified conditional test (Fisher's
  exact test per case, combined by convolution). It equals R's exact Mantel–Haenszel test, also with
  unequal arms (`test/reference-r-extra.json`). The Miettinen–Nurminen score test at 0 is not a
  regression test (decision 0005): its type-I error exceeds 0.05, exactly 0.0525 at 17 cases with 2
  trials (12 cases at rate 1, 3 at 0.8, 2 at 0.3) and 0.0559 at 5 cases with 5 trials and rate 0.1.
  The unit suite computes the first value by exact enumeration and requires the rule to fail it.
- **Unequal counts:** a within-case permutation test of the equal-weight mean difference: arm labels
  are permuted within each case (hypergeometric draws without replacement), by Monte Carlo with the
  seeded generator, p = (1 + count) / (1 + resamples). Under the sharp null it is valid for every
  number of resamples B: the chance of p ≤ 0.05 is at most 0.05, and it equals 0.05 only when
  (1 + B)·0.05 is a whole number. The type-I study uses 99 resamples, that worst case. The decision
  uses 10,000, where (1 + B)·0.05 is 500.05, so the test is valid and its level is 500/10,001, just
  under 0.05. A unit test checks it against the exact conditional p-value by enumeration.

Each result names its regression method in `regressionMethod`.

## Results of the CI gate

Two workflows run the studies with `pnpm --filter ./packages/stats run test:sim`:

- The `CI` workflow (`.github/workflows/ci.yml`), job `simulation`: on every pull request, every
  push to `main` and in the merge queue, with `ICHNAEA_SIM_REPS=6000` and a limit of 60 minutes.
- The `Nightly` workflow (`.github/workflows/nightly.yml`), job `simulation`: every day at 02:17
  UTC and on demand, with `ICHNAEA_SIM_REPS=10000` and a limit of 120 minutes.

`test:sim` runs five study files in parallel: `test/coverage.sim.test.ts`,
`test/checks-coverage.sim.test.ts`, `test/type-i-exact.sim.test.ts`,
`test/type-i-permutation-17.sim.test.ts` and `test/type-i-permutation-60.sim.test.ts`. Candidates
are confirmed in the same run.

The results at 6,000 repetitions, by the grid title that the CI log prints. Each study compares its
result with its row here and fails if they differ, so a change to a grid or to its results changes
this table in the same commit. At 10,000 repetitions a study compares only the points and the exact
points; the nightly log has the rest. A unit test (`test/validation-page.test.ts`) checks that the
table has one row per study and that the workflows use the repetitions above. "Confirmed" counts
the candidates that screening sent to confirmation. A grid marked "must fail" is a check of the
check: its study requires it to fail.

| Grid                                                   | Points | Exact | Confirmed | Minimum or maximum                                                                           | Mean   |
| ------------------------------------------------------ | ------ | ----- | --------- | -------------------------------------------------------------------------------------------- | ------ |
| `fixed-cases lower bound`                              | 622    | 558   | 3         | minimum 0.9431 (exact), k=5, candidate 2 trials against base 5 p=0.2 shift=0                 | 0.9648 |
| `unequal arms in every case (must fail)`               | 6      | 4     | 2         | minimum 0.9361 ± 0.0005 (confirmed), k=17, candidate 3 trials against base 2, p=0.95 shift=0 | 0.9375 |
| `biased bound (must fail)`                             | 1      | 0     | 1         | minimum 0.9289 ± 0.0005 (confirmed), bound + 0.02, k=17 r=2 p=0.9                            | 0.9289 |
| `variant without the factor (must fail)`               | 1      | 0     | 1         | minimum 0.9224 ± 0.0005 (confirmed), Mee, k=17 r=2 p=0.9                                     | 0.9224 |
| `exact stratified test, type-I error`                  | 45     | 28    | 0         | maximum 0.0395 ± 0.0025 (screen), k=60 r=3 0.7                                               | 0.0222 |
| `within-case permutation test, 17 cases, type-I error` | 6      | 0     | 1         | maximum 0.0414 ± 0.0004 (confirmed), k=17 r=2..3 0.7                                         | 0.0287 |
| `within-case permutation test, 60 cases, type-I error` | 6      | 0     | 1         | maximum 0.0454 ± 0.0005 (confirmed), k=60 r=2..3 0.7                                         | 0.0392 |

The coverage grid has exact points for 5 to 9, 12 and 13 cases at r = 2 and for 5 to 8 cases at
r = 3, at rates 0.05 to 0.99 and shifts +0.1 to −0.3. It has exact points with one-trial cells (5, 9
and 10 cases), with mixed counts (6 cases, 3 at r = 2 and 3 at r = 3) and with 2 candidate trials
against 5 base trials (5 cases). Its simulated points are:

- 17 and 60 cases at r = 2 and 3, with rates 0.7, 0.9 and 0.97, a mixture of stable and noisy
  cases, and low rates from 0.03 to 0.3, at true differences 0 and −0.05;
- heterogeneous effects (40 cases);
- missingness tied to the drop (6 and 12 of 60 cases lose 2 of 3 candidate trials), and missingness
  not tied to it;
- unequal trial counts (2 or 3 per case), with and without a drop on the cases with fewest trials,
  for 8, 17 and 60 cases, and 3 trials on 17 of 60 cases;
- 12 cases at r = 3 and at r = 2 to 3, and 17 cases where 3 cases keep 1 candidate trial.

The three confirmed coverage points pass, each at a difference of 0: 0.9514 ± 0.0005 (17 cases,
r = 2, rate 0.7), 0.9489 ± 0.0005 (17 cases, r = 3, rate 0.7) and 0.9472 ± 0.0004 (12 cases, r = 2
to 3, rate 0.9). The grid mean is 0.9648, above 0.95.

The checks of the check, each confirmed: a lower bound shifted up by 2 points fails, and so does the
variant without the N/(N−1) factor, both at 17 cases with r = 2 and rate 0.9. No simulation runs the
score test at 0 as a regression test any more. Instead the unit suite computes its type-I error
exactly (0.0525, see above) and requires the rule to fail it.

Seeds 1–999 serve coverage points, 1000–1999 type-I points, 9000 and above the checks of the check;
confirmations add 100,000.

## Floors and the minimum detectable effect

The zero-noise floor, the smallest margin that can pass when every trial passes in both arms, is

floor = z² / (K(r − ½) + z²), z = 1.645 (one-sided α = 0.05),

for K cases with r trials each. It depends on K(r − ½), not on the total number of trials:

| Cases | Floor, r = 2 | Floor, r = 3 |
| ----- | ------------ | ------------ |
| 17    | 0.096        | 0.060        |
| 20    | 0.083        | 0.051        |
| 52    | 0.034        | 0.020        |
| 60    | 0.029        | 0.018        |
| 250   | 0.007        | 0.004        |

`scripts/floors.ts` prints this table, and a test pins the closed form. `fixedCasesMde` simulates the
method itself: the power quantile (nearest rank) of the margins that pass when both arms share the
observed per-case rates.

## Not validated

| Method                                          | Use                                                                          | Measured                                                                                                                                                                                                                                              | Status                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Tango paired score interval, skewness-corrected | `sampled-cases`, one trial per case and arm, one case per family, 300+ cases | Agrees with ratesci on every table with n = 10 and 25 (and n = 6 and 12 in a second check). `validation/tango.tsv` is a study from before the fix of its skewness root; it must be rerun under the validation rule before the method gives a verdict. | Experimental: results are never validated, so no verdict.        |
| `sampled-cases` below 300 cases                 | —                                                                            | The sign-flip tests once used here reject far too often: non-inferiority up to 59%, and "no drop" 27.5% under a skewed null with mean 0. They were removed.                                                                                           | No method: `compareCounts` throws, the measure is estimate-only. |
| Proportion, score and ordinal measures          | —                                                                            | See above (decision 0008).                                                                                                                                                                                                                            | No method yet: estimate-only.                                    |
| Wilson interval for one proportion              | Per-arm rates in reports, never in a decision                                | Exact two-sided coverage at n = 20 is 0.9245 at p = 0.95, minimum 0.838 near p = 0.009 (`scripts/exact-wilson.ts`)                                                                                                                                    | Descriptive only.                                                |

The false-alarm part of REQ-58 (monitor statistics) belongs to the drift canary (step 7).
