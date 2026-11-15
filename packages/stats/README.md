# @hephaestus-build/ichnaea-stats

Statistics for Ichnaea decisions: score intervals for differences of proportions (stratified over
cases for the `fixed-cases` estimand, paired for `sampled-cases`), an exact stratified regression
test, randomisation tests, Holm and Benjamini–Yekutieli adjustment, power and minimum detectable
effects, and one seeded generator (32-bit Mersenne Twister) for every resampling method.

The package has no dependency on other Ichnaea packages and no Python or R at runtime. Its methods
are checked against an independent implementation and by simulation: see
[VALIDATION.md](VALIDATION.md), which also lists the methods that are not yet validated.

```ts
import { compareBinary, createRng } from "@hephaestus-build/ichnaea-stats";

const result = compareBinary({
  estimand: "fixed-cases",
  alpha: 0.05,
  margin: 0.05,
  cases: [
    { id: "a", base: [1, 1], candidate: [1, 0] },
    { id: "b", base: [1, 1], candidate: [1, 1] },
  ],
});
// result.difference: one-sided lower interval; result.nonInferiorityP; result.regressionP
```

Licence: MIT.
