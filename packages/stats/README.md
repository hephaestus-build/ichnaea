# @hephaestus-build/ichnaea-stats

Statistics for Ichnaea decisions: score intervals for differences of proportions (stratified over
cases with equal case weights for the `fixed-cases` estimand, paired for `sampled-cases`), an exact
stratified regression test, randomisation tests, Holm and Benjamini–Yekutieli adjustment, floors and
minimum detectable effects, and one seeded generator (32-bit Mersenne Twister) for every resampling
method. Every comparison says whether it lies inside the validated domain.

The package has no dependency on other Ichnaea packages and no Python or R at runtime. Its methods
are checked against an independent implementation and by simulation: see
[VALIDATION.md](VALIDATION.md), which also lists the methods that are not yet validated.

```ts
import { compareCounts } from "@hephaestus-build/ichnaea-stats";

const result = compareCounts({
  estimand: "fixed-cases",
  alpha: 0.05,
  margin: 0.05,
  cases: [
    {
      id: "a",
      base: { successes: 2, trials: 2, replicates: 2 },
      candidate: { successes: 1, trials: 2, replicates: 2 },
    },
    {
      id: "b",
      base: { successes: 5, trials: 6, replicates: 2 },
      candidate: { successes: 6, trials: 6, replicates: 2 },
    },
  ],
});
// result.difference: one-sided lower interval; result.nonInferiorityP; result.regressionP
```

Licence: MIT.
