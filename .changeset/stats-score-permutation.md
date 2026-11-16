---
"@hephaestus-build/ichnaea-stats": minor
---

`scorePermutationTest(cases, { seed, levels })` is the within-case permutation test for measures with one value in [0, 1] per trial: scores, proportions reduced to one value per trial, and equally spaced ratings. It is exact on a lattice of values when its work estimate allows, and otherwise Monte Carlo from the given seed, which the result records together with the path and the work. Its type-I study has not run yet, so nothing decides with it: score, proportion and ordinal measures stay estimate-only.
