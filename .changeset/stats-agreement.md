---
"@hephaestus-build/ichnaea": minor
---

`./stats` measures how well raters agree: `rawAgreement`, `cohenKappa` and `gwetAc1` from a table of counts, `confusionTable` to build that table from two raters' labels, and `krippendorffAlpha` with the nominal, ordinal or interval metric for any number of raters with missing values. The point estimates match R's irr and irrCAC, and alpha reproduces Krippendorff's published example. No interval for them is validated, and they decide nothing on their own. Kappa and alpha are NaN where they are undefined, for example when both raters chose one category for every item; AC1 is never NaN.
