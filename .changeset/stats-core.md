---
"@hephaestus-build/ichnaea-stats": minor
---

First statistics core. `compareCounts` decides one binary or proportion measure per estimand: for `fixed-cases`, the stratified Miettinen–Nurminen score interval and test with equal case weights (the mean of per-case differences) and the exact stratified conditional regression test; for `sampled-cases`, Tango's skewness-corrected score interval from 300 cases and otherwise a regression test only (both experimental). Each result says whether it lies inside the validated domain. Also Wilson intervals (descriptive), Holm and Benjamini–Yekutieli adjustment, closed-form floors, a simulated minimum detectable effect and a seeded Mersenne Twister. Checked against ratesci and R's exact Mantel–Haenszel test, exact enumeration and simulation (see VALIDATION.md).
