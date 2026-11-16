# Statistics: `@tumaet/ichnaea/stats`

Statistics for Ichnaea decisions on binary measures: score intervals for differences of proportions
(stratified over cases with equal case weights for the `fixed-cases` estimand, paired for
`sampled-cases`), an exact stratified regression test, a within-case permutation test, Holm and
Benjamini–Yekutieli adjustment, floors and minimum detectable effects, the drift guard of a `fast`
run with its detectable drift, and one seeded generator
(32-bit Mersenne Twister) for every resampling method. Every comparison has two results, each
saying whether it is validated and, if not, why: `regression` for the regression test, and
`nonInferiority` for the interval against the margin. No verdict may rest on a result that is not
validated. Score, proportion and ordinal measures have no validated method yet, so they are
estimate-only. At one trial per case and arm, the regression result is validated only when the
caller states that its checks of the records passed (`oneTrial`), and the non-inferiority result
never is (decision 0020).

**No non-inferiority result is validated yet.** The validated margin floor is not set. Exact
searches found coverage below the bar at margins from 0.05 to 0.185, with 5 to 8 cases and 3 trials
in a first search, and at 9 and 10 cases with mixed trial counts in a second (see
[VALIDATION.md](VALIDATION.md)). The change that sets the floor lists each point. Until the floor is
set, a comparison can show a regression, but it cannot show non-inferiority.

The statistics import nothing outside `src/stats`, and need no Python or R at runtime. Its methods
are checked against an independent implementation and by simulation: see
[VALIDATION.md](VALIDATION.md), which also lists the methods that are not yet validated.

```ts
import { compareCounts } from "@tumaet/ichnaea/stats";

// Each case: the completed binary trials that passed, of all completed trials, per arm.
const cases = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({
  id,
  base: { successes: 3, trials: 3 },
  candidate: { successes: i === 0 ? 2 : 3, trials: 3 },
}));
const result = compareCounts({
  valueType: "binary",
  estimand: "fixed-cases",
  alpha: 0.05,
  margin: 0.1,
  cases,
});
// result.difference: the one-sided lower interval; result.nonInferiorityP; result.regressionP and
// result.regressionMethod; result.regression and result.nonInferiority, each { validated, limitations }
```

Licence: MIT.

## Descriptive cluster estimates

`clusterBootstrap` estimates a row-weighted mean with a percentile interval from whole-cluster
resampling. It supports numeric outcomes and null values, which remain missing. It is estimate-only,
not a validated decision method. It never makes a non-inferiority or population claim.

```ts
import { clusterBootstrap, createRng } from "@tumaet/ichnaea/stats";

const estimate = clusterBootstrap(
  [
    { cluster: "case-a", value: 1 },
    { cluster: "case-a", value: 0 },
    { cluster: "case-b", value: 1 },
  ],
  { rng: createRng(42), resamples: 2000 },
);
// estimate.estimate, estimate.lower, estimate.upper
// estimate.sampling.mode === "native"; estimate.estimateOnly === true
```

To reproduce a registered analysis from another runtime, pass `schedule` instead of `rng` and
`resamples`. A schedule states its ordered `clusterIds`, zero-based `draws`, `algorithm`, and `seed`.
The result records replay mode. Store the schedule and its digest with the analysis. The method
refuses a schedule whose cluster IDs, dimensions, or indices do not match.

For paired differences, keep paired outcomes in each row and the family or case as its cluster.
For a planned-attempt denominator, supply the defined 0/1 operational outcome of every planned
attempt. Do not drop a row because its quality verdict is unavailable.

## Agreement between raters

`rawAgreement`, `cohenKappa` and `gwetAc1` take a square table of counts, one row and one column per
declared category. `confusionTable` builds that table from two raters' labels: a null label is
missing, and a label outside the declared categories throws. `krippendorffAlpha` takes one row per
item, with any number of raters and null for a missing value.

```ts
import { confusionTable, gwetAc1, krippendorffAlpha } from "@tumaet/ichnaea/stats";

const { table, skipped } = confusionTable(
  ["yes", "no", null, "no"],
  ["yes", "yes", "no", "no"],
  ["yes", "no"],
);
const ac1 = gwetAc1(table); // skipped === 1: the third item has one label only
const alpha = krippendorffAlpha(
  [
    [4, 5],
    [2, 2],
    [3, null],
  ],
  "ordinal",
);
```

These are point estimates, validated against R. No interval for them is validated: an interval
from resampling whole cases is estimate only. Kappa and alpha are NaN where they are undefined, and
a resample can hit that: count those replicates and report their share, never drop them. AC1 is
never NaN. `VALIDATION.md` lists the oracles and the limits.

## One-arm estimates

`estimate` gives one arm's mean over the cases that ran (`these-cases`), or over a population with a
declared sampling frame (`population`), with its interval, the worst-case bounds and the
operational estimate with missing trials as failures. Each interval says what its coverage rests
on: `conservative` or `not-validated`. It decides nothing.

```ts
import { estimate } from "@hephaestus-build/ichnaea/stats";

const result = estimate({
  valueType: "binary",
  cases: [
    { id: "a", values: [1] },
    { id: "b", values: [0] },
    { id: "c", values: [], planned: 1 },
  ],
});
// result.interval: Clopper–Pearson at the adjusted level, coverage "conservative";
// result.worstCase: { low, high };
// result.operational: the interval over planned trials, missing as failure
```

`reduceTrials` gives pass^k, pass@k or a majority per case. `kaplanMeier`, `survivalQuantile`,
`restrictedMean` and `restrictedDifference` handle times censored at the plan's limit.
`missingDifferenceTest` flags a difference in missing trials between the arms.

## Must-never ceilings and noise

`neverClaim` shows or does not show a ceiling on a must-never measure's violation rate, and
`neverCasesNeeded` gives the clean cases a ceiling needs. `stratifiedZ` and `overdispersion` give
the noise runs' z and the reported ratio Σz²/N.
