# Writes test/reference-r-normal.json: R's pnorm and qnorm on a grid that covers both tails, with 17
# significant digits. Test-only oracle; base R only. Run in a container:
#   docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w rocker/r-ver:4.5.2 Rscript scripts/reference-normal.R
# The platform matters: R on arm64 gives slightly different last digits.
# The grid has points on both sides of each branch boundary: |x| = 0.67448975 and sqrt(32), and
# R 4.5's tail bounds -38.4674 and 8.2924.
edges <- c(0.6, 0.67, 0.67448975, 0.6745, 0.7, 5.6, 5.656854, 5.6569, 5.7, 37.5193, 37.52)
bounds <- c(-38.47, -38.4674, -38.467, -38.46, 8.29, 8.2924, 8.2925, 8.3)
x <- sort(unique(c(seq(-38, 38, by = 0.25), edges, -edges, bounds, -37.5, -8.3, -1e-8, 0, 1e-8, 0.46875,
                   -0.46875, 4, -4, 1.6448536269514722, 1.959963984540054, -5.5, 5.5, 26.5, -26.5)))
p <- sort(unique(c(1e-300, 1e-200, 1e-100, 1e-50, 1e-20, 1e-15, 1e-10, 1e-8, 1e-6, 1e-5, 1e-4,
                   0.001, 0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.2, 0.25, 0.3, 0.4, 0.425, 0.45,
                   0.4999999, 0.5, 0.5000001, 0.55, 0.575, 0.6, 0.7, 0.75, 0.8, 0.9, 0.925, 0.95,
                   0.975, 0.99, 0.995, 0.999, 0.9999, 0.99999, 0.999999, 1 - 1e-8, 1 - 1e-10,
                   1 - 1e-12, 1 - 1e-15, seq(0.01, 0.99, by = 0.01),
                   # Both sides of the branch boundaries |p - 0.5| = 0.425 and r = 5 (p = exp(-25)).
                   0.0749, 0.0751, 0.9249, 0.9251, 1e-11, 1.3e-11, 1.4e-11, 2e-11,
                   # Subnormal p, where r = sqrt(-log p) passes 27 (p below about 2.5e-317).
                   1e-310, 1e-316, 2e-317, 3e-317, 1e-318, 1e-320, 1e-322, 5e-324,
                   10^seq(log10(5e-324), log10(2.5e-317), length.out = 200))))
num <- function(v) ifelse(is.infinite(v), ifelse(v > 0, '"inf"', '"-inf"'), sprintf("%.17g", v))
pairs <- function(a, b) paste0("[", num(a), ", ", num(b), "]", collapse = ",\n    ")
cat(sprintf('{\n  "oracle": "%s",\n  "pnorm": [\n    %s\n  ],\n  "qnorm": [\n    %s\n  ]\n}\n',
            R.version.string, pairs(x, pnorm(x)), pairs(p, qnorm(p))),
    file = "test/reference-r-normal.json")
