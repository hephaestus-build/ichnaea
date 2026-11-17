# Statistics validation

This page records the evidence behind each method in `@hephaestus-build/ichnaea/stats`: agreement
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

`test/stats/validation-rule.test.ts` pins every threshold at its edge with exact points and Bernoulli
experiments of known rate, in the unit suite: exact 0.9399 and 0.94 − 1e-9 fail and 0.94 passes; a
true 0.936 and 0.937 fail and 0.9395 passes after confirmation; a grid mean of 0.945 fails; nine
screened points at 0.9465 fail on the grid mean (3·SE of the mean, the SEs added in quadrature) and
nine at 0.949 pass; exact type-I 0.0501 fails; a true 0.0527 fails and 0.0505 passes; confirmation
uses the seed plus 100,000.
`scripts/stats/mutants.ts` changes each threshold, the confirmation and the cap: 16 mutants (those named `rule:`), and
the unit suite detects each one.

## Reference values

`test/stats/reference-ratesci.json` comes from the R package ratesci 1.1.1 and R's `mantelhaen.test`
(`scripts/stats/reference.R`, run in a container as a test-only oracle). Ichnaea agrees with:

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

- `test/stats/reference-numpy-mt19937.json` comes from numpy 2.3.4 (`scripts/stats/reference-mt19937.py`):
  `MT19937` with legacy integer seeding, for seeds 1, 42, 5489, 2026 and 2^32 − 1. Ichnaea gives
  the same 1,300 raw 32-bit outputs per seed (two state regenerations) and the same 700
  `random_sample` doubles, bit for bit. The old library gave the same sequence, so every seeded
  stream is unchanged. Values derived through the normal functions are not bit for bit the same:
  the old library's `pnorm` and `qnorm` differed from R's in the last digits, so critical values,
  bounds, p-values and the simulated MDE can move by a few units in the last place. For example,
  `critical(0.9, "two")` was 1.6448536269514724 and is now 1.6448536269514715.
- `src/normal.ts` uses the same algorithms as R 4.5.2: Cody for `pnorm` and AS 241 for `qnorm`,
  with R's tail bounds (−38.4674 and 8.2924) and R's asymptotic expansion for subnormal p.
  `test/stats/reference-normal-coefficients.json` holds every coefficient and branch bound of
  `src/normal-coefficients.ts` as printed in R's source at the tag R-4-5-2
  (`scripts/stats/reference-normal-coefficients.ts`), and a test requires the code to use exactly those
  values. This check is needed because a wrong literal can stay inside every accuracy bound: moving
  qnorm's central bound from 0.425 to 0.42 costs at most 2.8 ε·|v|. A wrong digit in a coefficient
  can be invisible in every output: a review found `5226.495278852546` for R's
  `5226.4952788528545610`, a change of about 1e-19 relative, which no reference value detects.
- `test/stats/reference-mpmath-normal.json` holds the true values, from mpmath 1.3.0 at 60 digits and
  rounded to the nearest double (`scripts/stats/reference-normal-mpmath.py`). It has `pnorm` at 13,052
  points from −40 to 10 and `qnorm` at 3,930 probabilities from 5e-324 to 1 − 1e-16: a regular
  grid, small |x| down to 1e-12, extra points on both sides of every branch boundary and beyond
  R's tail bounds, and 9,000 seeded random points across the branch regions. Errors are stated in
  ε·|v| (ε = 2^-52, so 1 ε·|v| is between 1 and 2 units in the last place). Ichnaea is within
  2.5 ε·|v| for `pnorm` with |x| ≤ 1 and within 4 elsewhere, plus 4 subnormal steps near the
  bottom of the double range. The worst measured errors are 2.16 and 2.98 for `pnorm`, 2.82 for
  `qnorm`, and one subnormal step.
- `test/stats/reference-r-normal.json` comes from R 4.5.2 (`scripts/stats/reference-normal.R`): `pnorm` at 356
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

`scripts/stats/mutants.ts` changes coefficients, every branch bound and cutoff, the tail bounds and the
generator: 22 mutants of `normal.ts`, `normal-coefficients.ts`, `mt19937.ts` and `rng.ts`, and the tests detect every one. One change is not detectable: a change to the fifth-order
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
counts differ. `test/stats/decision-values.test.ts` pins a two-case example.

The interval is the stratified Miettinen–Nurminen score interval with the N/(N−1) factor and no
skewness correction (decision 0004), chosen by a 252-point study at 10,000 repetitions
(`scripts/stats/study-fixed-cases.ts`, `validation/fixed-cases.json`):

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
- no excluded case, except at one trial per case under its conditions (below), where a case
  without its pair counts against coverage instead;
- at most 3 completed trials per case and arm. Suites run 2 or 3, and the search for heterogeneous
  effects covers 2, 3 and mixed counts;
- at least 90% of case-arm cells with 2 or more completed trials (missingness that leaves some cells
  with one trial is studied), or exactly one completed trial in every cell, for `regression` only
  and under the conditions of "One trial per case: the binary regression test" (decision 0020).
  Mixed one and two trials stay under the 90% rule.

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
(`scripts/stats/exact-coverage.ts`), and two confirmed points at 17 cases:

| Cases | Candidate 3 trials, base 2      | Candidate 2 trials, base 3      |
| ----- | ------------------------------- | ------------------------------- |
| 5     | **0.9381** (rate 0.9)           | 0.9452                          |
| 6     | **0.9374** (rate 0.9)           | 0.9448                          |
| 7     | **0.9383** (rate 0.9)           | 0.9456                          |
| 8     | **0.9397** (rate 0.9)           | 0.9413                          |
| 9     | 0.9408                          | **0.9384** (rate 0.05)          |
| 10    | 0.9415                          | **0.9366** (rate 0.05)          |
| 17    | **0.9361 ± 0.0005** (rate 0.95) | **0.9370 ± 0.0005** (rate 0.05) |

The CI gate leaves this pattern out. A second study in `test/stats/coverage.sim.test.ts` requires six of
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
  unequal arms (`test/stats/reference-r-extra.json`). The Miettinen–Nurminen score test at 0 is not a
  regression test (decision 0016): its type-I error exceeds 0.05, exactly 0.0525 at 17 cases with 2
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

### One trial per case: the binary regression test

With one trial per case and arm, the exact stratified conditional test is the exact conditional
McNemar test: a case where both arms agree adds nothing, and given n discordant cases, the number c
where only the candidate passes is Binomial(n, 1/2) under the sharp null. That test is exact. What
had to be shown is the weak null: per-case effects that differ but average 0, which is what a
fixed-cases comparison of a suite means by "no change". **The validated domain includes one trial per
case for the regression result, under the conditions below (decision 0020).** This study is its
evidence. Non-inferiority at one trial per case is not validated.

`scripts/stats/study-binary-one-trial.ts` computes the type-I error exactly. Cases are independent, so a
dynamic programme over (n, c) gives the distribution of the discordant counts, and the rejection
region comes from the decision path itself: `compareCounts` gives the p-value of every (n, c), and
the region c ≤ c\*(n) is checked to equal the exact McNemar test's for every n up to 300. A unit
test checks the dynamic programme against enumeration of all 4^k outcome pairs through
`compareCounts`, at k ≤ 8 (agreement within 1e-15).

- **Structures, at a true mean difference of 0:** the sharp null, a fixed grid with one to three
  noisy cases, and 2,000 random structures per k and family, then hill-climbing from the worst 5
  (4 rounds of 5 steps). Family "top": most cases pass the base always or nearly always and drop
  under the candidate by unequal amounts; one to three noisy cases rise to offset the drops, the
  shape that made the interval undercover. Family "floor" mirrors it, so the long tail of the
  per-case differences lies on the drop side, the side the test looks at.
- **Grid and seeds:** k from 5 to 20, and 25, 30, 40, 60, 100, 146, 200 and 300. MT19937, seed
  5,000,000 + 1,000·f + the index of k, with f = 1 for "top" and 2 for "floor". Each (family, k)
  keeps its seed at every level, so every level searches the same random structures.
- **Levels:** α = 0.05, and the Holm levels α/m for m = 2, 3 and 4 (0.025, 0.0167 and 0.0125). A
  REGRESSION verdict compares Holm-adjusted p-values across the primary measures, so the test must
  hold at α/m as well. The rejection region at each level is checked against the exact McNemar
  test's in integer arithmetic. 431,983 structures over the four levels.
- **Rule:** an exactly computed point fails above its level.
- **Result: no point fails at any level, from 5 to 300 cases.** The worst type-I error per k, with
  "e" for a structure with an effect somewhere and "n" for one with no effect in any case:

| Level  | 5 cases | 8       | 10      | 12      | 14      | 17      | 20      | 30      | 60      | 100     | 146     | 300     |
| ------ | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| 0.05   | 0.0006e | 0.0039e | 0.0059e | 0.0067e | 0.0091e | 0.0114n | 0.0155n | 0.0207n | 0.0312n | 0.0344n | 0.0369n | 0.0392n |
| 0.025  | 0.0000n | 0.0006e | 0.0013e | 0.0017e | 0.0027e | 0.0035n | 0.0060n | 0.0100n | 0.0144n | 0.0150n | 0.0172n | 0.0190n |
| 0.0167 | 0.0000n | 0.0006e | 0.0013e | 0.0016e | 0.0025e | 0.0033n | 0.0051n | 0.0063n | 0.0084n | 0.0098n | 0.0108n | 0.0127n |
| 0.0125 | 0.0000n | 0.0001e | 0.0002e | 0.0003e | 0.0007e | 0.0010e | 0.0020n | 0.0046n | 0.0067n | 0.0078n | 0.0085n | 0.0094n |

From about 15 cases up, the worst structure has no effect in any case: no heterogeneous structure
was worse than the sharp null. Hoeffding (1956) gives the reason. Given the discordant cases, the
count of candidate-only cases is a sum of independent chances that differ between cases (a
Poisson-binomial). A Poisson-binomial with the same mean as the Binomial(n, 1/2) that the test
conditions on has lower-tail probabilities no larger than the binomial's. **The study, not the
theorem, is the evidence:** effects whose rates average 0 do not by themselves fix that conditional
mean at n/2, so the theorem alone does not cover every structure here. Below 15 cases the test is
so discrete that every error stays under 0.01. `validation/binary-one-trial.tsv` lists the worst
structure of each level, k and family in full, and a unit test recomputes each listed value from
its structure. Its sidecar records the commit, the script hashes, the seeds and the Node version.

- **Claim:** no failure found in this space, which is a search, not a proof. A structure outside it
  may still fail.
- **Conditions for a validated result at one trial per case.** `compareCounts` validates the
  regression result at exactly one completed trial in every case-arm cell of at least 5 cases only
  when its caller states, as `oneTrial`, that its checks of the records passed. Without it, the
  result names "one trial per case needs decide's checks of the trial order, the timestamps and the
  A/A runs". `decide` runs these checks for a plan that runs exactly one trial per case in its base
  and candidate arms. Each check that fails is a limitation of the regression result, which then
  gives no REGRESSION:
  - **The order within each pair is random.** A fair coin per case chooses which arm runs first:
    SHA-256 over the canonical JSON of `{ seed, case }`, with the plan's seed record and the case
    ID; the candidate runs first when the lowest bit of the first byte is 1 (`candidateRunsFirst`).
    The plan lists the trials case by case in that order, so its order is the run order, and
    `batch` numbers the pairs. `decide` recomputes the coin: a case whose trials ran in the other
    order (by `startedAt`; a tie is not the other order) is unpaired. The stated assumption is that
    a run-level shock is shared by both arms of a case. With one trial per arm, a shock between the
    arms cannot be told apart from an effect, and a random order keeps a drift over the run from
    favouring one arm. This study has no shocks, so it sets no shock bound.
  - **Both arms of a case ran adjacent in time.** Every trial that ran records `startedAt` and
    `endedAt`; otherwise the result is not validated, because "the records do not show when the arms
    ran". c is the largest number of trials whose half-open [startedAt, endedAt) intervals overlap, computed
    from the records. The trials are ranked by `startedAt`, ties broken by trial ID, and a case whose
    two trials' ranks differ by more than 2c − 1 is unpaired. There is no fixed time window.
  - **Unpaired cases and missing trials.** A case without its pair, unpaired or with a missing
    trial, is excluded from the comparison and counts against coverage, exactly as a missing trial
    does. The coverage floor decides whether too many were lost, so one retry never invalidates a
    whole run. The sensitivity analysis covers them.
  - **The schedule.** The plan states `schedule`: the concurrency and the endpoint the run uses.
  - **A/A runs.** The plan cites, in `aa`, at least two distinct A/A decisions by run and decision
    digest (`ichnaea import --aa <run>`), and the caller gives each with its plan and run. Each
    one must:
    1. match its cited digest, and name the given plan and run by their digests;
    2. compare one configuration with itself: both arms have the same identity;
    3. run one trial per case and arm;
    4. run this plan's suite (the same `suiteDigest`);
    5. meet these conditions itself: it is a decision, not INVALID, and every primary measure's
       regression result is validated. An A/A plan waives only its own A/A precondition;
    6. give no REGRESSION for any primary measure, after Holm;
    7. be one of at least two distinct such decisions;
    8. match this plan's base model (the configuration's `models`, compared as the identity
       projection does) and its schedule. The base configuration's own identity need not match.
  - **Non-inferiority** at one trial per case needs its own floor sweep: with one trial per arm
    most pairs agree, the zero-variance mechanism that sets the margin floor. Until then, its
    result names "non-inferiority is not validated at one trial per case", and one trial per case
    can give REGRESSION but never PASS.
- **Limitations `decide` cannot check.** It trusts the timestamps as recorded; an importer that
  merges the records of several hosts states its clock source. Every decision at one trial per
  case says so. A provider-side change behind the same model ID is not detected, so A/A runs on
  the same model ID can hide it.
- **The owner rule, which `decide` cannot see.** An A/A REGRESSION is never discarded. It blocks
  validation at one trial per case for that suite, model and schedule until its cause is found and
  two later, consecutive A/A decisions are clean. The cited records must be the two most recent A/A
  decisions.

## Results of the CI gate

Two workflows run the studies with `pnpm --filter @hephaestus-build/ichnaea run test:sim:stats`:

- The `CI` workflow (`.github/workflows/ci.yml`), job `simulation`: on every pull request, every
  push to `main` and in the merge queue, with `ICHNAEA_SIM_REPS=6000` and a limit of 60 minutes.
- The `Nightly` workflow (`.github/workflows/nightly.yml`), job `simulation`: every day at 02:17
  UTC and on demand, with `ICHNAEA_SIM_REPS=10000` and a limit of 120 minutes.

`test:sim` runs seven study files in parallel: `test/stats/coverage.sim.test.ts`,
`test/stats/checks-coverage.sim.test.ts`, `test/stats/type-i-exact.sim.test.ts`,
`test/stats/type-i-permutation-17.sim.test.ts`, `test/stats/type-i-permutation-60.sim.test.ts`,
`test/stats/score-permutation-work.sim.test.ts`, which times the score permutation test at its work
limit and judges no grid, and `test/stats/score-ni-equivalence.sim.test.ts`, which checks the score
non-inferiority study's decision against the root-finder and judges no grid. Candidates are
confirmed in the same run.

The results at 6,000 repetitions, by the grid title that the CI log prints. Each study compares its
result with its row here and fails if they differ, so a change to a grid or to its results changes
this table in the same commit. At 10,000 repetitions a study compares only the points and the exact
points; the nightly log has the rest. A unit test (`test/stats/validation-page.test.ts`) checks that the
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

## Descriptive cluster percentile estimates

`clusterBootstrap` resamples whole clusters and computes the mean of their observed rows in each
draw. Unequal clusters keep their row weights. Null values stay missing, and their clusters remain
in the resampling frame. A planned-attempt estimand supplies its defined binary outcome for every
planned attempt instead of dropping unavailable quality evidence.

The method is **estimate-only**, not a validated decision method. It never establishes
non-inferiority or a population claim. Nominal coverage is not established at any cluster count. A constant
resampling distribution is marked degenerate, with no coverage claim. Draws containing only missing
values are omitted and counted explicitly.

Native mode uses the package's seeded MT19937 generator. Replay mode consumes a recorded cluster
schedule and checks its ordered cluster IDs, dimensions, indices, algorithm, and seed. It does not
claim that a seed from another generator produces the same draws.

`scripts/stats/reference-cluster-bootstrap.R` generates synthetic reference vectors with base R 4.5.2 in
`rocker/r-ver:4.5.2@sha256:fd4ccdd3a4a6f7ef805e2daeee2a0fe3bf126bc231f36351223baecf5a595a4c`.
The committed TSV includes every cluster draw. It covers binary outcomes, unequal cluster sizes,
missing values, paired differences, and a degenerate distribution. The tests match R's observed mean
and type-7 percentile bounds within an absolute tolerance of 1e-12. This numerical agreement does
not validate coverage or a decision rule.

Regenerate from `packages/ichnaea`, as CI does:

```sh
docker run --rm --network none -v "$PWD":/w -w /w \
  rocker/r-ver:4.5.2@sha256:fd4ccdd3a4a6f7ef805e2daeee2a0fe3bf126bc231f36351223baecf5a595a4c \
  Rscript scripts/stats/reference-cluster-bootstrap.R
```

## Agreement between raters

`rawAgreement`, `cohenKappa`, `gwetAc1` and `krippendorffAlpha` (nominal, ordinal and interval
metrics) are point estimates. They decide nothing on their own.

**What is validated, and what is not.**

- Validated: the point estimates, against the oracles below.
- Not validated: any interval for these statistics. A caller can resample whole cases (the items of
  one case are not independent), but no coverage study backs such an interval, and a percentile
  interval for kappa can undercover at small n and near the boundaries. An interval from it is
  estimate only, with coverage not studied.
- Not implemented: weighted kappa, and kappa or AC1 for more than two raters.

**NaN replicates.** Kappa is NaN when both raters put every item in one category. Alpha is NaN when
no two values can be paired or no paired value differs. A case resample can hit either. A caller
that resamples counts the NaN replicates and reports their share. It never sorts them into a
percentile and never drops them silently. AC1 is never NaN: its chance term is at most 1/q.

Two definitions to know:

- **AC1 counts the declared categories.** Its chance term divides by q − 1, where q is the size of
  the table, so a category that nobody chose still counts. Kappa does not depend on unused
  categories.
- **Only paired items count.** `confusionTable` leaves out an item that either rater did not label.
  Gwet's general formula for raw ratings also estimates category shares from unpaired ratings; this
  implementation does not, so it compares a judge and raters on exactly the same items.

**Alpha's cost.** It keeps a v × v coincidence matrix for v distinct values. It is meant for rating
scales with a few levels. With thousands of distinct values (continuous scores), use another
statistic.

The reference values come from test-only oracles in the R image that CI pins. The inputs are
synthetic (`scripts/stats/agreement-fixtures.ts` writes them).

| Set                                                                                                                                               | Oracle                                                                                                                                                                                                        | Size          | Tolerance                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| Raw agreement, kappa and AC1 from tables of 2–7 categories, including the prevalence pair with equal raw agreement and a declared unused category | R irrCAC (`kappa2.table`, `gwet.ac1.table`); kappa also from irr (`kappa2`)                                                                                                                                   | 35 tables     | 1e-12                                                                |
| Confusion tables from labels with missing values, and their kappa                                                                                 | R `table` and irr `kappa2`                                                                                                                                                                                    | 5 label pairs | exact, and 1e-12                                                     |
| Krippendorff's alpha, three metrics, 2–5 raters, missing values, including unequally spaced non-integer values                                    | R irr (`kripp.alpha`), a base-R implementation written from Krippendorff's definition by a separate author, and Krippendorff's published example; nominal and interval also from irrCAC (`krippen.alpha.raw`) | 12 matrices   | 1e-12 (irr, base R); 6e-6 (irrCAC, which rounds alpha to 5 decimals) |
| Krippendorff's published example (12 units, 4 raters): 0.743, 0.815, 0.849                                                                        | Krippendorff (2011)                                                                                                                                                                                           | 1             | 3 decimals                                                           |

The ordinal alpha, the decision statistic for rating levels, uses Krippendorff's frequency-based
distance. Its oracles are irr (`kripp.alpha`, method "ordinal"), the base-R implementation and the
published example. irrCAC's ordinal weights are rank-based, not Krippendorff's metric, so irrCAC is
never an oracle for ordinal alpha; it stays the oracle for AC1.

`scripts/stats/reference-base-r-alpha.R` uses no package. Its author wrote it from Krippendorff's
definition without seeing the TypeScript implementation, so it is an independent second source. It
reads the matrices as one row per cell (`test/stats/reference-alpha-units.tsv`, written by the
fixture script) and needs no network. The Python package `krippendorff` agreed with these values
too, but it is GPL-licensed, which is outside the repository's licence allowlist, so it is not a
committed oracle.

Regenerate from `packages/ichnaea`, as CI does:

```sh
node scripts/stats/agreement-fixtures.ts
docker run --rm -v "$PWD":/w -w /w \
  rocker/r-ver:4.5.2@sha256:fd4ccdd3a4a6f7ef805e2daeee2a0fe3bf126bc231f36351223baecf5a595a4c \
  Rscript scripts/stats/reference-agreement.R
docker run --rm --network none -v "$PWD":/w -w /w \
  rocker/r-ver:4.5.2@sha256:fd4ccdd3a4a6f7ef805e2daeee2a0fe3bf126bc231f36351223baecf5a595a4c \
  Rscript scripts/stats/reference-base-r-alpha.R test/stats/reference-alpha-units.tsv test/stats/reference-base-r-alpha.tsv
```

`reference-agreement.R` installs irr, irrCAC and jsonlite from a dated CRAN snapshot, so it needs the
network. The base-R script does not.

## The judge calibration rule: operating characteristics

A model judge is `calibrated` only when its labels, set against two human raters' labels on the same
answers, pass a rule. This study measures how often that rule admits a judge that is as good as a
rater, a worse one, an uninformative one or a biased one. It describes the rule; it does not validate
an interval or a decision method.

**The rule studied** (`scripts/stats/calibration-rule.ts`; the study takes it as a parameter):

- **The rater floor, a precondition.** The one-sided 95 % lower bound of rater–rater agreement must
  be at least 0.60 (Gwet's AC1, yes/no labels) or 0.667 (Krippendorff's ordinal alpha, 5 levels).
- **The gap form.** For a statistic S(x, y) of reader x against reference y, the judge J and the
  raters H1 and H2:

  G = ½ [S(J, H1) + S(J, H2)] − ½ [S(H2, H1) + S(H1, H2)]

  Both halves come from the same resampled cases, so the interval counts the raters' sampling error
  as well as the judge's. A condition holds when G's one-sided 95 % lower bound is at least
  −tolerance. The rule bounds this gap, never the judge's own value of S.
  - Yes/no labels: AC1 at tolerance 0.15, and sensitivity and specificity at tolerance 0.10 each.
  - Levels: ordinal alpha at tolerance 0.15.

- **The bias gate.** Per answer, the judge's value minus the raters' mean value, on [0, 1] (a level
  l counts as (l − 1)/4). The bias is its mean on the candidate's answers minus its mean on the
  base's. The gate holds when the bias's two-sided 90 % interval lies within ±0.20 (yes/no) or ±0.15
  (levels). The shown bound is max(|lower|, |upper|). Answers from a known-worse configuration take
  no part in it. The gate applies to every judge measure, secondary measures too.
- **Calibrated** means that every condition holds. The `pass` column is the share of studies in which
  they all held.
- Every statistic is weighted by 1/π, for inclusion probability π. One bootstrap of 2,000 resamples
  per study resamples whole cases within their strata. A resample with an undefined statistic (no
  positive or no negative to condition on) is left out of that statistic's quantile; `nanShare`
  counts it.

**The synthetic studies** (`scripts/stats/calibration-rule-study.ts`):

- **Generic cells.** 60 cases (or the size the cell names), each with one answer from the base and
  one from the candidate, and a shared case effect drawn as N(0, 0.7²). Every answer weighs 1.
  - Yes/no: an answer is positive (a defect) with probability prevalence · e^(0.5 · case effect),
    clamped to [0.02, 0.95]. Each rater reads it correctly with probability 0.90, and the judge with
    its own accuracy. A biased judge misses true positives more often on the candidate; its false
    positives stay as they are. A chance judge says yes at the prevalence without reading; an
    always-no judge never says yes. The prev0.35 cells draw positives at 0.35, and every answer weighs 1.
    They study no weighting. Only the draw cells study an oversampled, weighted draw. The
    at-bound cell's judge has a mean bias of −0.20 on the candidate, the bias gate's bound.
  - Levels: a latent quality (case effect plus N(0, 0.7²)) is cut into 5 levels at −1.2, −0.4, 0.4
    and 1.2. Rater readings add N(0, 0.6²). The judge adds its own noise, and a biased judge shifts
    its reading on the candidate.
- **Draw cells** reproduce the registered draw:
  - a screen of 127 items, 2 runs per item from each of the base (C1), the candidate (C2) and a
    known-worse configuration (C3);
  - defect rates 0.15, 0.15 and 0.35 per answer. Within an item, the latent Gaussian scores behind
    the defects, and behind each reader's errors, correlate at ρ = 0.3: an answer's score is
    √ρ · (item's score) + √(1 − ρ) · (its own), cut at a threshold. ρ is not the correlation of the
    yes/no outcomes, which is smaller and depends on the threshold;
  - a deterministic proxy that catches 0.65 of the defects (the obvious ones) and flags 0.01 of the
    good answers; readers are 0.07 more accurate on an obvious defect and 0.07 less on a subtle one;
  - a draw of n answers: 0.29 n each from C1 and C2 and the rest from C3, with proxy-positive shares
    0.20, 0.20 and 0.40, at most 2 proxy-positive answers per item, each answer weighted 1/π;
  - raters at accuracy 0.90 (raw agreement 0.82), a good judge at 0.90 and a clearly worse judge at
    0.80.

  The 360-answer draw is then rerun with one assumption changed: latent ρ = 0 or 0.6, raters at 0.93 (raw
  agreement 0.87), or a C1→C3 defect-rate rise of 0.10 or 0.30 instead of 0.20. "Without C3" is a
  140-answer draw of C1 and C2 alone, with positive shares 0.35.

**Results.** 2,000 studies per cell, seed 6,000,000 + cell index, from
`validation/calibration-rule.tsv` and its sidecar. The Monte Carlo standard error of a rate is at most
0.011. "Floor" is the share of studies whose raters meet the floor; "Bias ≤ m" is the share whose
shown bias bound is at most m.

Generic cells, yes/no labels, 60 cases:

| Cell                   | Judge                     | Pass  | Floor | AC1   | Sensitivity | Specificity | Bias gate | Mean bias | Bias ≤ 0.10 | Bias ≤ 0.20 |
| ---------------------- | ------------------------- | ----- | ----- | ----- | ----------- | ----------- | --------- | --------- | ----------- | ----------- |
| Prevalence 0.2         | as good as a rater (0.90) | 0.120 | 0.474 | 0.788 | 0.479       | 0.797       | 0.825     | 0.00      | 0.039       | 0.825       |
|                        | slightly worse (0.85)     | 0.019 | 0.506 | 0.298 | 0.309       | 0.332       | 0.708     | 0.00      | 0.004       | 0.708       |
|                        | clearly worse (0.80)      | 0.002 | 0.467 | 0.066 | 0.220       | 0.077       | 0.571     | 0.00      | 0.000       | 0.571       |
| Prevalence 0.1         | as good as a rater        | 0.172 | 0.730 | 0.836 | 0.381       | 0.817       | 0.836     | 0.00      | 0.036       | 0.836       |
|                        | clearly worse             | 0.006 | 0.735 | 0.079 | 0.300       | 0.064       | 0.579     | 0.00      | 0.002       | 0.579       |
| Prevalence 0.2, biased | as good as a rater        | 0.022 | 0.481 | 0.752 | 0.102       | 0.904       | 0.624     | −0.068    | 0.027       | 0.624       |
|                        |                           | 0.001 | 0.469 | 0.696 | 0.012       | 0.960       | 0.267     | −0.136    | 0.006       | 0.267       |
|                        |                           | 0.000 | 0.471 | 0.640 | 0.001       | 0.989       | 0.070     | −0.204    | 0.000       | 0.070       |
| Prevalence 0.1         | chance                    | 0.000 | 0.729 | 0.380 | 0.000       | 0.879       | 0.625     | 0.00      | 0.002       | 0.625       |
|                        | always no                 | 0.000 | 0.732 | 0.981 | 0.000       | 1.000       | 0.939     | 0.00      | 0.120       | 0.939       |
| Prevalence 0.05        | chance                    | 0.004 | 0.832 | 0.973 | 0.004       | 1.000       | 0.867     | 0.00      | 0.063       | 0.867       |
|                        | always no                 | 0.001 | 0.832 | 1.000 | 0.001       | 1.000       | 0.980     | 0.00      | 0.333       | 0.980       |
| Prevalence 0.35        | as good as a rater        | 0.051 | 0.242 | 0.739 | 0.595       | 0.742       | 0.828     | 0.00      | 0.043       | 0.828       |
|                        | clearly worse             | 0.000 | 0.231 | 0.053 | 0.153       | 0.097       | 0.572     | 0.00      | 0.000       | 0.572       |
|                        | chance                    | 0.000 | 0.244 | 0.000 | 0.000       | 0.002       | 0.107     | 0.00      | 0.000       | 0.107       |
|                        | always no                 | 0.000 | 0.252 | 0.001 | 0.000       | 1.000       | 0.675     | 0.00      | 0.001       | 0.675       |

Generic cells, prevalence 0.35, by study size (good judge at 0.90, worse at 0.80):

| Cases | Good: pass | Good: floor | Good: sensitivity | Good: bias gate | Worse: pass |
| ----- | ---------- | ----------- | ----------------- | --------------- | ----------- |
| 120   | 0.204      | 0.331       | 0.814             | 0.990           | 0.000       |
| 135   | 0.249      | 0.347       | 0.872             | 0.997           | 0.001       |
| 150   | 0.268      | 0.351       | 0.888             | 1.000           | 0.000       |
| 180   | 0.339      | 0.401       | 0.925             | 1.000           | 0.000       |

Generic cells, 5 levels, 60 cases:

| Judge                          | Mean bias | Pass  | Floor | Ordinal alpha | Bias gate | Bias ≤ 0.10 | Bias ≤ 0.15 |
| ------------------------------ | --------- | ----- | ----- | ------------- | --------- | ----------- | ----------- |
| as good as a rater (noise 0.6) | 0.00      | 0.056 | 0.070 | 0.919         | 0.962     | 0.609       | 0.962       |
| noisier (0.9)                  | 0.00      | 0.002 | 0.061 | 0.256         | 0.818     | 0.313       | 0.818       |
| much noisier (1.2)             | 0.00      | 0.000 | 0.077 | 0.017         | 0.659     | 0.107       | 0.659       |
| as good as a rater, shifted    | 0.065     | 0.038 | 0.074 | 0.858         | 0.695     | 0.234       | 0.695       |
|                                | 0.128     | 0.008 | 0.067 | 0.733         | 0.147     | 0.010       | 0.147       |

Draw cells (the registered draw):

| Draw              | Good: pass | Good: floor | Good: sensitivity | Good: bias gate | Worse: pass | Positives drawn | Effective positives (Kish) |
| ----------------- | ---------- | ----------- | ----------------- | --------------- | ----------- | --------------- | -------------------------- |
| 140               | 0.134      | 0.545       | 0.587             | 0.579           | 0.002       | 46              | 39                         |
| 200               | 0.258      | 0.630       | 0.688             | 0.774           | 0.006       | 68              | 56                         |
| 260               | 0.434      | 0.710       | 0.776             | 0.891           | 0.004       | 87              | 72                         |
| 300               | 0.544      | 0.759       | 0.833             | 0.934           | 0.007       | 99              | 83                         |
| 360               | 0.641      | 0.805       | 0.860             | 0.975           | 0.014       | 114             | 99                         |
| 460               | 0.815      | 0.889       | 0.938             | 0.993           | 0.022       | 129             | 119                        |
| 360, ρ = 0        | 0.732      | 0.867       | 0.888             | 0.966           | 0.012       | 117             | 102                        |
| 360, ρ = 0.6      | 0.535      | 0.738       | 0.810             | 0.979           | 0.012       | 109             | 95                         |
| 360, raters 0.93  | 0.918      | 0.999       | 0.932             | 0.994           | 0.032       | 114             | 99                         |
| 360, C3 rise 0.10 | 0.690      | 0.870       | 0.841             | 0.978           | 0.013       | 96              | 83                         |
| 360, C3 rise 0.30 | 0.630      | 0.748       | 0.911             | 0.978           | 0.011       | 126             | 112                        |
| 140, raters 0.93  | 0.458      | 0.932       | 0.702             | 0.758           | 0.011       | 46              | 39                         |
| 140, without C3   | 0.168      | 0.608       | 0.499             | 0.782           | 0.003       | 49              | 32                         |

No resample had an undefined statistic in the draw cells or the level cells. In the rare-positive
yes/no cells, at most 0.002 % of resamples had one.

**What the tables show.**

- **No uninformative judge passes.** At prevalence 0.05, a chance judge and an always-no judge pass
  AC1 in 97–100 % of studies, because AC1 rewards agreement on the many negatives. The sensitivity
  gap stops them: they pass the whole rule in at most 0.4 % of studies.
- **The bias gate catches what agreement misses.** A yes/no judge with a mean bias of −0.20 passes
  AC1 in 64 % of studies and the bias gate in 7 %.
- **The clearly worse judge stays out.** It passes in at most 0.6 % of generic studies and at most
  3.2 % of draws, below the 5 % target everywhere.
- **The rater floor binds before the judge does.** At 60 cases, raters at raw agreement 0.82 reach
  the floor in 47 % of studies at prevalence 0.2, and level raters reach it in 6–8 %. A good judge
  therefore passes in at most 17 % of 60-case studies. At 60 cases, the rule mostly reports that the
  raters' own agreement is not shown.
- **The registered draw.** With raters at accuracy 0.90, the good judge passes 64 % of 360-answer
  draws and 82 % of 460-answer draws. The 80 % target needs about 460 answers. With raters at 0.93
  (raw agreement 0.87), 360 answers give 92 %. Raters' agreement, measured in the rater check
  before the draw is fixed, therefore decides the size more than any other assumption. At ρ = 0.6 the
  360-answer draw falls to 53 %.
- **A judge-based Pass is rarely reachable.** It needs the Pass margin β_L · 0.10 − B to be
  positive, where β_L is the lower bound of the judge's slope against people on the base and
  known-worse answers, and B is the bias bound on that pair. For a judge as good as a rater, the
  margin is positive in 7.4 % of 460-answer draws, in 12 % of 360-answer draws whose raters agree at
  0.87 (1.4 % with raters at 0.90), and in at most 0.2 % of draws below 360 answers (column
  `passable`).
- **The bias gate costs little in a large draw.** It holds in 97–99 % of 360- and 460-answer draws.
  In 140-answer draws it holds in 58–78 %, so a small draw often fails the gate even for an unbiased judge.

**Limits.** The raters and the judge are synthetic. The numbers describe this rule on these
generators. They are not the coverage of an interval, and they do not validate a decision method. The
draw cells use assumed defect rates, proxy recall and ρ; the screen measures them. A rule,
generator or allocation change needs a rerun.

Rerun from `packages/ichnaea` (about an hour on 4 cores), or with the `Calibration rule study`
workflow. `$out` is an empty directory:

```sh
out=$(mktemp -d)
for i in 0 1 2 3; do node scripts/stats/study-calibration-rule.ts shard --shard "$i/4" --out "$out" & done; wait
node scripts/stats/study-calibration-rule.ts merge --in "$out" validation/calibration-rule.tsv
```

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

`scripts/stats/floors.ts` prints this table, and a test pins the closed form. `fixedCasesMde` simulates the
method itself: the power quantile (nearest rank) of the margins that pass when both arms share the
observed per-case rates.

## Not validated

| Method                                          | Use                                                                          | Measured                                                                                                                                                                                                                                              | Status                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Tango paired score interval, skewness-corrected | `sampled-cases`, one trial per case and arm, one case per family, 300+ cases | Agrees with ratesci on every table with n = 10 and 25 (and n = 6 and 12 in a second check). `validation/tango.tsv` is a study from before the fix of its skewness root; it must be rerun under the validation rule before the method gives a verdict. | Experimental: results are never validated, so no verdict.        |
| `sampled-cases` below 300 cases                 | —                                                                            | The sign-flip tests once used here reject far too often: non-inferiority up to 59%, and "no drop" 27.5% under a skewed null with mean 0. They were removed.                                                                                           | No method: `compareCounts` throws, the measure is estimate-only. |
| Proportion, score and ordinal measures          | —                                                                            | See above (decision 0008). The regression test for them exists and matches its oracles; its type-I study has not run (see below).                                                                                                                     | No method yet: estimate-only.                                    |
| Wilson interval for one proportion              | Per-arm rates in reports, never in a decision                                | Exact two-sided coverage at n = 20 is 0.9245 at p = 0.95, minimum 0.838 near p = 0.009 (`scripts/stats/exact-wilson.ts`)                                                                                                                              | Descriptive only.                                                |

The false-alarm part of REQ-58 (monitor statistics) belongs to the drift canary (step 7).

## Score measures: the regression test

`scorePermutationTest` is the regression test for measures with one value in [0, 1] per trial:
scores, proportions reduced to one value per trial (never their items as trials), and ratings whose
levels are equally spaced. **Nothing decides with it yet.** Its type-I study has not run, so score,
proportion and ordinal measures stay estimate-only (decision 0008).

- **Statistic:** T = (1/k) Σᵢ (mean candidate value − mean base value) over the k cases with a
  completed trial in each arm. Every case has equal weight, as in the fixed-cases estimand. A value
  outside [0, 1], or one that is not finite, is refused. A case without a completed trial in an arm
  does not enter.
- **Permutation:** within each case, the pooled trials are reassigned to the arms, keeping each
  arm's completed count. Cases are permuted independently. The null is "no difference in any case".
  With one trial per case and arm this is a within-case sign flip.
- **p-value:** one-sided toward a drop, P(T* ≤ T), with ties counted as at most T.
- **The exact path:** every value is a multiple of 1/D for some D ≤ 1,000, found within 1e-9 (a
  1–5 rating normalised as (s − 1)/4 has D = 4; 3-decimal scores have D = 1,000). T is then a
  weighted sum of within-case candidate sums on an integer lattice, and its null distribution is
  their convolution. It runs when every case has at most 100,000 labellings and the work estimate W
  is at most 5·10⁷ (below). Each case's distribution comes from a dynamic programme over the smaller
  arm. The result records W.
- **The Monte Carlo path, otherwise:** 10,000 resamples from the caller's seed, p = (1 + count) /
  (1 + B), reported with its standard error and seed. A p within 3 standard errors of a level it is
  compared with (α, or a Holm level) is computed again with 100,000 resamples and the seed (seed +
  1,000,003) mod (2³² − 1), or 1 if that gives 0, since the generator's seeds run from 1 to
  2³² − 1. The reported p is the rerun's. The function takes a seed, not a generator, so the
  recorded seed always reproduces the p-value.

### The work limit of the exact path

W = Σᵢ (support of the partial distribution before case i) × (number of distinct contributions of
case i), with the cases taken in a canonical order computed from the table alone. W is the number of
multiply-adds the convolution performs, so it is computed before any of them, never from a clock,
and the same table always takes the same path. The limit counts work, not the size of the result: a
limit of 5·10⁷ on the support times the number of cases let 146 cases of 3-decimal scores with 3
trials run for over a minute.

`scripts/stats/benchmark-score-permutation.ts` times the exact path against W on tables like real suites
(1–5 ratings, proportions of 20 items, 2- and 3-decimal scores, 1 to 9 trials, 12 to 300 cases).
The time per unit of W is about 4–40 ns on an Apple M3 Max under heavy load from other jobs. The
`simulation` CI job (`test/stats/score-permutation-work.sim.test.ts`) takes, for five shapes, the
largest table whose W is within the limit, runs it exactly on the CI runner, prints its time and
fails above 3 seconds. The limit aims at about 1 second there. On the CI runner (`ubuntu-latest`,
image 20261103.629, Node 24) the largest exact tables took:

| Shape                      | Cases | W          | Seconds |
| -------------------------- | ----- | ---------- | ------- |
| 3-decimal scores, 3 trials | 68    | 48,987,374 | 0.136   |
| 3-decimal scores, 2 trials | 161   | 49,456,927 | 0.184   |
| 3-decimal scores, 1 trial  | 495   | 49,952,430 | 0.355   |
| 2-decimal scores, 3 trials | 226   | 49,696,804 | 0.179   |
| 3-decimal scores, 9 trials | 3     | 38,365,728 | 0.126   |

The slowest is 0.36 s, so the limit stays at 5·10⁷.

### Reference values

`test/stats/reference-score-permutation-tables.json` holds 248 tables (`scripts/stats/score-permutation-tables.ts`,
seed 20261116):

- 1–5 ratings with k from 1 to 146 and 1 to 3 trials, mixed counts, arm-unequal and one-trial
  cells;
- proportions with 3 to 20 items, and with different item counts in one table;
- a bimodal judge (0, 0.5 or 1);
- scores rounded to 2 and 3 decimals (D = 100 and 1,000), with 1 to 3 trials and unequal counts;
- edge tables: every value equal within a case, every case equal, values exactly 0 and 1, ties
  across cases, k = 5 with one noisy case, and a case with an empty arm;
- values off every small lattice, where Ichnaea runs Monte Carlo.

Every value is an integer number of units over the table's denominator, so each oracle reads exact
rationals. Two oracles, both test-only, rerun in the `stats oracle` CI job, which fails if a file
changes:

| Oracle                                                                                      | Result                                                                             | Agreement                                                                   |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R coin 1.4.6, `independence_test(y ~ arm \| case)`, exact (`reference-score-permutation.R`) | 232 tables exact, 4 constant, 12 by 10⁶ resamples (values off every small lattice) | exact: within 2e-15 (bar 1e-9); resampled: within 1.8 SE of the exact value |
| Exact enumeration in Python with rational arithmetic (`score_permutation_oracle.py`)        | All 248 tables: brute force (135) or convolution (113)                             | within 2.2e-15 (bar 1e-12)                                                  |

coin's statistic is the plain candidate sum, so the R script first multiplies each case's values
by an integer multiple of (nC + nB)/(nC·nB); scaling inside a stratum commutes with permutation
inside it. The Python oracle was written from a formula-only specification, without the TypeScript,
and checks itself first: brute force equals its convolution on 200 random tables, and its own Monte
Carlo is within 4 SE on 13. Ichnaea enumerates 236 tables exactly. The other 12 run Monte Carlo and
are within 2.0 SE of the exact value (bar 4 SE).

The unit suite pins every limit at its edge: D = 1,000 is found and 1/1,001 is not; a value 5e-10
off a multiple of 1/1,000 is off the lattice; values whose products with D fall just below an
integer (0.57, 0.58 and 0.29 at D = 100) round to it; a case with 100,000 labellings enumerates and
one with 100,001 does not; the largest table within the work limit enumerates and the next runs
Monte Carlo; the rerun seed at the wrap; and that the reported p is the rerun's, equal to a fresh
run at the rerun's seed. `scripts/stats/mutants.ts` changes the test in 19 ways, mutants S1 to S19 (ties, weights, tails, the
+1, sampling with replacement, the range check, the case count, the recomputation near a level, the
enumeration cap, the lattice size, tolerance and rounding, the work limit, the rerun seed and the p
it reports), and the unit suite detects every one.

### The type-I study (fixed before it runs; it has not run)

The study judges the test at a true difference of 0, at one-sided α = 0.05 and at the Holm levels
α/m for m = 2, 3 and 4 (0.025, 0.05/3 and 0.0125). A REGRESSION verdict compares Holm-adjusted
p-values across the primary measures, so the test must keep each level. Every point records its
rejections at the four levels from the same repetitions, and the rule below applies at each.

- **Inside the simulation** the test runs Monte Carlo with 239 resamples. (1 + B)·level is then a
  whole number at every level (12, 6, 4 and 3), so the test's size under exchangeability is exactly
  the level. With 99 resamples it would be 0.02, 0.01 and 0.01 at the three Holm levels, and a
  check at those levels would let the test exceed them by 20–40% unseen. The comparison with a
  level allows a relative 1e-9, because p = (1 + count)/240 lands on the levels exactly.
- **The rule, at each level:** a point screens at 6,000 repetitions. It is confirmed if its
  estimate is above level − 2·SE at any level, with SE = √(p̂(1 − p̂)/n) from the estimate itself.
  A confirmation draws from the point's confirmation seed in batches until the SE is at most 0.0005
  at every level, and runs at least 190,000 repetitions, so an estimate of 0 cannot stop it. A
  confirmed point fails if its estimate − 3·SE is above the level at any level.
- **Exact computation is not used.** The rejection rate of the 239-resample test needs every joint
  outcome of a cell enumerated, and the smallest grid cells are already too large (a bimodal judge
  at k = 5 with 2 trials has 81⁵ ≈ 3.5·10⁹ outcomes), so every point is simulated.
- **Seeds**, MT19937, each point with its own generator. Uniqueness holds within this study, and
  the harness asserts the bounds below. Seeds may repeat across studies: each study's claim stands
  on its own, and two older studies use seeds inside the 2,000,000, 10,000,000 and 20,000,000
  ranges.
  - Generator g (not G2), cell c < 1,000: screen 2,000,000 + 1,000·g + c, confirmation
    3,000,000 + 1,000·g + c, re-check 4,000,000 + 1,000·g + c.
  - G2 cell c′ < 1,000, structure s < 1,000: screen 10,000,000 + 1,000·c′ + s, confirmation
    20,000,000 + …, re-check 25,000,000 + …. The cell's random structures and its perturbations
    come from the stream 2,002,000 + c′, which c′ < 1,000 keeps below generator 3's seeds.
  - Every output records its commit, script sha256, seeds, arguments, runtime and runner.
- **Generators**, each at a true difference of 0:
  - per-case beta scores, Beta(μν, (1 − μ)ν) with μ from {0.05, 0.2, 0.5, 0.8, 0.95} and ν ∈
    {2, 10, 50};
  - heterogeneous per-case effects with mean 0, in two families: most cases near the top (μ = 0.95)
    drop slightly and 1–3 noisy cases rise to offset them; and its mirror, most cases near the floor
    (μ = 0.05) rise slightly and the noisy cases carry the drop, so the long tail of the per-case
    differences lies on the side the test looks at. ν ∈ {2, 10}, and 500 random structures per
    cell. Then hill-climbing from the worst 5: each chain tries 4 rounds of 5 perturbations (scale
    the stable effects by 0.7–1.3, move the noisy base by up to ±0.1) and moves to one that is
    worse, the largest estimate/level over the levels. That is 100 refinement structures per cell,
    s = 500–599, where step t of chain h is s = 500 + 20·h + t whether or not its perturbation
    stays inside [0.01, 0.99]. Every structure's true mean difference is 0 to 1e-12.
  - **The space the random structures search:** 1–3 noisy cases offset the drops of all the stable
    cases, and the noisy case's means must stay inside [0.01, 0.99]. At large k this keeps the
    stable drops small: at k = 300 with one trial most structures have 3 noisy cases and drops of at
    most about 0.02; at k = 146 with 2 trials the floor family's drops reach about 0.04. Larger
    drops at large k need more noisy cases, which the generator does not draw.
  - symmetric ±d with d ∈ {0.05, 0.1, 0.2}: bases 0.2, 0.5 and 0.8 in turn, half the cases rise by
    d and half drop. At d = 0.2 some means are exactly 0 or 1, and those arms are point masses, not
    beta draws; the mean difference is still 0;
  - unequal variances in the two arms at the same mean (ν 2 against 50, either way);
  - run-level shocks per replicate and arm, with SD 0, 0.01, 0.02, 0.05 and 0.10, shared across
    arms (interleaved) or not. With one trial per case, shared shocks count and separate shocks are
    reported, because a separate shock cannot be told apart from an effect;
  - proportions from a beta-binomial with 3, 5, 10 or 20 items and intra-output correlation 0, 0.2
    or 0.5;
  - a bimodal judge: 0 or 1, and 0.5 with probability 0.1 or 0.3;
  - 1–5 ratings from a latent normal with even or skewed thresholds.
- **Grid:** k ∈ {5, 8, 10, 12, 17, 20, 30, 60, 146} with 2 or 3 trials per case and arm, equal or
  mixed across cases, up to 10% of cells with one trial; and one trial per case and arm at
  k ∈ {12, 17, 20, 30, 60, 100, 146, 200, 300}. Arm-unequal cells (3 against 2) run and are
  reported, outside the domain. G2 has 307 cells: 4 random-structure settings and 3 symmetric ones
  on each of the 43 shapes, and 6 reported cells below the grid.
- **Reported, outside the grid:** the top family with one trial per case at k = 5, 8 and 10. A
  prototype found the sign flip above the bar there: 0.0575 ± 0.0016 at k = 5 and 0.0585 ± 0.0017
  at k = 8, the case-level form of the sign flip's known failure with few clusters. These points
  never set the domain.
- **Holm across correlated primaries, reported:** six cells with four primary measures on the same
  cases and no change, each through the shipped test, Holm across the four, at 20,000
  repetitions. Three take G2 structures (one noisy case pair, d = 0.05): per trial a shared
  x ~ Beta(mean, ν), and each measure a beta of mean x and its own precision (2, 5, 10 or 50).
  Three take G5 proportions: per trial a shared rate from the beta of ICC ρ, and each measure its
  own binomial items at that rate. They report the familywise rate and each measure's rate. They
  are evidence only: Holm holds under any dependence when each test holds at its level, which the
  four-level rule checks.
- **Re-check with the shipped test:** every point that is confirmed or fails, whatever its role,
  the 10 worst type-I points of each generator, and, apart, the 10 worst reported points of each
  generator, ranked by the largest estimate/level. Each runs at 20,000 repetitions from its
  re-check seed: every repetition draws one data set and runs both the shipped test (exact, or
  10,000 resamples with the rerun near each level) and the study's 239-resample test on it.
  - A point fails if the shipped test's estimate − 3·SE is above a level, at any level; the SE is
    about 0.0015 at 0.05.
  - **The pooled check**, per level, over the re-checked type-I points: the mean of (shipped −
    study) must not exceed 3 pooled standard errors. The standard error comes from the paired
    differences: per point (n₁₀ + n₀₁ − (n₁₀ − n₀₁)²/n)/n², with n₁₀ the repetitions where only the
    shipped test rejects and n₀₁ those where only the study's does, pooled as √Σ/N. The estimates
    are fresh, never the screening estimates that selected the worst points. The check is
    one-sided: the claim is about the shipped test, and on a lattice the shipped exact test and the
    study's Monte Carlo test differ by design, so a negative mean (the shipped test more
    conservative) is reported, not failed. Points where the shipped test took the exact path in
    every repetition, in none, and in some are pooled apart, and each pool is reported.
  - The re-checks of reported points are reported, outside the pooled check.
  - The validity claim rests on the study's own points at SE ≤ 0.0005; the re-check shows that the
    shipped path behaves as the study's.
- **What decides:**
  - The validated domain will need equal completed counts in the two arms of every case. A
    variant fills missing trials as the sensitivity analysis does against a drop (a missing
    candidate trial scores 1, a missing base trial 0), with up to 10% of trials missing at random
    or tied to the outcome, in either arm. If it passes, a run with missing trials can give a
    validated REGRESSION through it; otherwise any missing trial leaves the domain.
  - The domain will need interleaved arms, checked from the trial records, and states the largest
    run-level shock SD that passes.
  - With one trial per case, the domain starts at k1, the smallest grid k from which every larger
    grid k passes.
  - A failing structure class leaves the domain and is named here.
- **Must fail**, so the harness is shown to catch a failure: a proportion's items run through the
  binary exact test as independent trials; the test under a run-level shock of SD 0.15 without
  interleaving; a Wald z-test with plug-in within-case variances and no floor, under the mirrored
  family; and, with one trial per case, the paired t-test at k = 5 under the top family. A
  permutation across cases is reported, not used as a must-fail: pooling adds the spread between
  cases, so it is conservative (0.000–0.016 in a prototype) and cannot fail.
- **The collector** (`scripts/stats/collect-score-type-i.ts`) applies the rule again to every count:
  a stage or a fail flag that the counts do not give, a confirmation that stopped early, a
  must-fail that does not fail, or a failing pool fails the study. It derives the re-check list
  again from the screen and refuses a list or a shard that differs. A smoke run never passes. The
  summary prints the thresholds in effect.

## Score measures: non-inferiority

Three candidate bounds for the one-sided 95% lower bound of the equal-weight mean of per-case
differences, for values in [0, 1] (`src/stats/score-interval.ts`, internal: nothing decides with them,
and the package does not export them). **None is validated. Stage 1 of their study, which chooses
one, has not run.** Score, proportion and ordinal measures stay estimate-only for non-inferiority.

- **S-A:** the shipped stratified Miettinen–Nurminen score interval (equal case weights, the N/(N−1)
  factor, no skewness correction), with the sum of each cell's values as fractional successes.
- **S-B:** S-A with its variance multiplied by φ = max(φ̂, φ_min), where the pooled dispersion
  φ̂ = Σ SS / Σ [(n − 1)·ȳ(1 − ȳ) + SS/n] runs over every cell of both arms. The bracket is n − 1
  times an unbiased estimate of μ(1 − μ), so φ̂ estimates Var(Y)/(μ(1 − μ)). It is exactly 1 for 0/1
  values, so S-B is S-A on binary data, and at most 1 for any values in [0, 1]. The simpler
  Σ SS / Σ n·ȳ(1 − ȳ) estimates (n − 1)φ/(n − φ), about half of φ at two values per cell; it runs in
  the study only as a reported variant. φ only scales the variance, so the bound at φ is the root
  of Z₁ at the target z·√φ, and at φ = 0 it is the estimate.
- **S-C:** a stratified t bound with one pooled within-cell variance and df = Σ (n − 1);
  unavailable without residual degrees of freedom.

**Reference values.** On the 248 tables of the regression test, S-A, S-B at every φ_min, S-C, φ̂ and
the estimate match an R implementation and S-B a Python implementation, both written from a
formula-only specification without the TypeScript (`scripts/stats/reference-score-intervals.R`,
`scripts/stats/score_intervals_oracle.py`). S-A also matches ratesci's stratified score interval with
fractional counts. Largest differences: 2.1e-13 (R), 6.7e-14 (Python), 2.6e-11 (ratesci, which
rounds its output to 12 decimals); the bars are 1e-10 and 1e-9.

**The root-finder's path is shared.** The binary intervals' root-finder (`lowerRoot`, `src/stats/solve.ts`)
and the study's decision "the bound is at most θ" (`lowerRootAtMost`) share one scan and one
bisection. The decision follows the root-finder's own path and stops once the answer is certain, so
it equals `lowerRoot(...) ≤ θ` for every function. On the machine that runs the tests, every
binary bound on the reference inputs (2,088) is computed with the current root-finder and with a
verbatim copy of the one before the change (`test/stats/support/solve-before-refactor.ts`, whose body
a sha256 pins to the old file), and all agree bit for bit. V8's Math is not bit-identical across
platforms: the same Node version on linux x64 and macOS arm64 moved 2 of the 2,088 bounds in their
last bits. So the stored bounds (`test/stats/reference-solver-snapshot.json`) record the runtime
that wrote them, Node version, platform and CPU architecture, and are compared bit for bit on that
runtime and within 1e-9 on any other. Bit reproducibility holds for one runtime; a study's shards
all run on one, record it, and the collectors refuse outputs from different runtimes.

**A known property of the score statistic, binary or not:** Z(δ) need not be monotone. A case whose
two arms are both all 1 (or all 0) adds no variance at δ = 0 and some next to it, so Z can rise near
δ = 0; a prototype found such bumps within δ ∈ [−0.08, 0.04] on synthetic tables built at those
boundaries, and none on tables drawn from the study's generators. The root-finder takes the first
crossing from −1, so the shipped bound is well defined, and the binary claim covers that bound. The
study's decision follows the same path, so it needs no monotonicity; its equivalence test
(`test/stats/score-ni-equivalence.sim.test.ts`) counts the non-monotone tables per kind and compares
every setting with a full `lowerRoot` on 10,000 tables.
