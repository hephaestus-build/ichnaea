# @hephaestus-build/ichnaea-stats

Statistics for Ichnaea decisions on binary measures: score intervals for differences of proportions
(stratified over cases with equal case weights for the `fixed-cases` estimand, paired for
`sampled-cases`), an exact stratified regression test, a within-case permutation test, Holm and
Benjamini–Yekutieli adjustment, floors and minimum detectable effects, and one seeded generator
(32-bit Mersenne Twister) for every resampling method. Every comparison has two results, each
saying whether it is validated and, if not, why: `regression` for the regression test, and
`nonInferiority` for the interval against the margin. No verdict may rest on a result that is not
validated. Score, proportion and ordinal measures have no validated method yet, so they are
estimate-only.

**No non-inferiority result is validated yet.** The validated margin floor is not set: a search
found coverage below the bar at small margins (see [VALIDATION.md](VALIDATION.md)). Until the floor
is set, a comparison can show a regression, but it cannot show non-inferiority.

The package has no runtime dependency, and no Python or R at runtime. Its methods
are checked against an independent implementation and by simulation: see
[VALIDATION.md](VALIDATION.md), which also lists the methods that are not yet validated.

```ts
import { compareCounts } from "@hephaestus-build/ichnaea-stats";

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
