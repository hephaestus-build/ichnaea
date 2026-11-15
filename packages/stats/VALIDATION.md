# Statistics validation

This page records the evidence behind each method in `@hephaestus-build/ichnaea-stats`: agreement
with an independent implementation, and simulation studies of coverage and type-I error.

The bar (REQ-50, REQ-111): on a stated grid, no point may fall below nominal coverage by more than
3 Monte Carlo standard errors, and the grid mean may not fall below nominal. With 10,000
repetitions per point the per-point tolerance at 95% is 0.0065.

## Reference values

`test/reference-ratesci.json` holds 186 intervals from the R package ratesci 1.1.1
(`scripts/reference.R`, run in a container as a test-only oracle). Every Wilson, Miettinen–Nurminen,
Mee, skewness-corrected, stratified and Tango interval agrees to 1e-6.

## fixed-cases: stratified score interval for the difference of proportions

Study: `scripts/study-fixed-cases.ts`, results in `validation/fixed-cases.json`. 252 points: 10, 17,
30 and 60 cases; 2, 3 and 5 replicates per case and arm; per-case rates all 0.5, 0.7, 0.9, 0.97 or
1, a mixture of stable and noisy cases, and a Beta(8, 2) draw; true differences 0, −0.05 and −0.10.
One-sided 95% lower bounds.

| Variant                                                     | Minimum coverage | Mean coverage | Points below the band |
| ----------------------------------------------------------- | ---------------- | ------------- | --------------------- |
| Miettinen–Nurminen (N/(N−1) factor, no skewness correction) | 0.9424           | 0.9605        | 1                     |
| Mee (no factor)                                             | 0.9164           | 0.9462        | 154                   |
| Skewness-corrected (no factor)                              | 0.8819           | 0.9432        | 166                   |
| Skewness-corrected with the factor                          | 0.9207           | 0.9598        | 2                     |

Decision: Miettinen–Nurminen is the default. Without the N/(N−1) factor the interval undercovers
when each case has only 2 or 3 trials per arm.

At the points that matter for non-inferiority (true difference at −0.05 or −0.10) its minimum is
0.9446, inside the band. One point at a true difference of 0 lies below the band: 17 cases, 5
replicates, every case at 0.97. A confirmation run of 200,000 repetitions gives 0.9435 (Monte Carlo
standard error 0.0005), so the undercoverage is real and comes from discreteness. It affects a
superiority claim at a true difference of 0 (type-I error about 5.65% instead of 5%), not the
non-inferiority test. Open: a superiority claim needs a method that meets the bar there.

The zero-noise floor (the smallest margin that can pass when every trial passes in both arms) of
this method is larger than the approximation z²/(n·r + z²), which matches the variant without the
factor:

| Applicable cases | Floor, r = 2 | Floor, r = 3 | z²/(n·r + z²), r = 2 |
| ---------------- | ------------ | ------------ | -------------------- |
| 17               | 0.096        | 0.060        | 0.074                |
| 20               | 0.083        | 0.051        | 0.063                |
| 52               | 0.034        | 0.020        | 0.025                |
| 60               | 0.029        | 0.018        | 0.022                |
| 250              | 0.007        | 0.004        | 0.005                |

`scripts/floors.ts` prints this table.

## fixed-cases: exact stratified conditional regression test

The regression test (H0: no drop) is the exact stratified conditional test: Fisher's exact test per
case, combined by convolution. In the same study its type-I error with no change has a maximum of
0.0427 and a mean of 0.0228. The score test at 0 reaches 0.0858, so it is not used for the
regression test.

## CI gate

`test/coverage.sim.test.ts` runs a 48-point fixed-cases grid and the regression test's type-I check
on every pull request with 2,000 repetitions, and nightly with 10,000. It also shows that the check
fails a lower bound shifted up by 2 points and a Wald interval at n = 20.

## Not yet validated to the bar

| Method                                          | Use                                       | Measured                                                                                                                                                                                             | Status                                                                        |
| ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tango paired score interval, skewness-corrected | `sampled-cases`, one trial per case       | Minimum 0.936, mean 0.960 over 40 points (`validation/tango.tsv`). Below the band at 15 cases with heavy discordance and with a structurally empty cell. The uncorrected interval has minimum 0.927. | Experimental. A decision built on it states that the method is not validated. |
| Sign-flip randomisation on family differences   | `sampled-cases` with families             | Not yet studied for shifted nulls with binary outcomes                                                                                                                                               | Experimental                                                                  |
| Wilson interval for one proportion              | Per-arm rates in reports, never a verdict | Two-sided coverage 0.9185 at n = 20, p = 0.95 (a known dip near the boundary)                                                                                                                        | Descriptive only                                                              |
