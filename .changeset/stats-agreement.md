---
"@hephaestus-build/ichnaea": minor
---

`./stats` measures how well raters agree: `rawAgreement`, `cohenKappa` and `gwetAc1` from a table of counts, `confusionTable` to build that table from two raters' labels, and `krippendorffAlpha` with the nominal, ordinal or interval metric for any number of raters with missing values. They match R's irr and irrCAC within 1e-12, and alpha reproduces Krippendorff's published example. They are point estimates and decide nothing on their own. A value that is undefined, such as kappa when both raters chose one category for every item, is NaN.
