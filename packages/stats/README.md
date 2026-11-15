# @hephaestus-build/ichnaea-stats

Statistics for Ichnaea decisions on binary measures: score intervals for differences of proportions
(stratified over cases with equal case weights for the `fixed-cases` estimand, paired for
`sampled-cases`), an exact stratified regression test, a within-case permutation test, Holm and
Benjamini–Yekutieli adjustment, floors and minimum detectable effects, and one seeded generator
(32-bit Mersenne Twister) for every resampling method. Every comparison says whether it lies inside
the validated domain and, if not, why. No verdict may rest on a comparison outside it. Score,
proportion and ordinal measures have no validated method yet, so they are estimate-only.

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
const result = compareCounts({ estimand: "fixed-cases", alpha: 0.05, margin: 0.1, cases });
// result.difference: the one-sided lower interval; result.nonInferiorityP; result.regressionP and
// result.regressionMethod; result.validated and result.limitations
```

Licence: MIT.
