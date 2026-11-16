# Writes test/stats/reference-coin-score-permutation.json: the within-case permutation test on scores, from
# coin's stratified independence test, for every table of test/stats/reference-score-permutation-tables.json.
# Test-only oracle, on R 4.5.2 with coin and jsonlite from a dated CRAN snapshot. Run in a container:
#   docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w rocker/r-ver:4.5.2 Rscript scripts/reference-score-permutation.R
#
# The test's statistic is T = mean over cases of (mean candidate - mean base). Within a case the
# pooled values are fixed, so T is, up to a constant, sum_i w_i * (candidate sum of case i) with
# w_i = (nC + nB) / (nC * nB). coin's linear statistic for the two-sample problem with strata is the
# plain candidate sum, so each case's values are multiplied by an integer multiple of w_i first:
# scaling inside a stratum commutes with permutation inside it. With values as integer units, the
# scaled responses are integers and coin's exact algorithm applies.
repos <- "https://packagemanager.posit.co/cran/__linux__/noble/2026-11-01"
dir.create("/tmp/rlib", showWarnings = FALSE)
.libPaths(c("/tmp/rlib", .libPaths()))
suppressMessages(install.packages(c("coin", "jsonlite"), lib = "/tmp/rlib", repos = repos, quiet = TRUE))
suppressMessages({ library(coin); library(jsonlite) })

gcd <- function(a, b) if (b == 0) a else gcd(b, a %% b)
lcm <- function(a, b) a / gcd(a, b) * b

# Tables with a denominator above this run coin's Monte Carlo distribution instead of the exact one.
EXACT_DENOMINATOR <- 1000
RESAMPLES <- 1e6

input <- fromJSON("test/stats/reference-score-permutation-tables.json", simplifyVector = FALSE)
results <- lapply(input$tables, function(t) {
  cases <- Filter(function(c) length(c$candidate) > 0 && length(c$base) > 0, t$cases)
  nc <- sapply(cases, function(c) length(c$candidate))
  nb <- sapply(cases, function(c) length(c$base))
  m <- Reduce(lcm, nc * nb, 1)
  w <- m * (nc + nb) / (nc * nb)
  y <- unlist(lapply(seq_along(cases), function(i) w[i] * c(unlist(cases[[i]]$candidate), unlist(cases[[i]]$base))))
  arm <- factor(unlist(lapply(seq_along(cases), function(i) c(rep("candidate", nc[i]), rep("base", nb[i])))),
                levels = c("candidate", "base"))
  stratum <- factor(unlist(lapply(seq_along(cases), function(i) rep(i, nc[i] + nb[i]))))
  data <- data.frame(y = y, arm = arm, stratum = stratum)
  constant <- all(tapply(data$y, data$stratum, function(v) length(unique(v)) == 1))
  if (constant) return(list(id = t$id, p = 1, method = "constant"))
  if (t$denominator <= EXACT_DENOMINATOR) {
    p <- pvalue(independence_test(y ~ arm | stratum, data = data, distribution = "exact", alternative = "less"))
    list(id = t$id, p = as.numeric(p), method = "exact")
  } else {
    set.seed(20261116)
    p <- pvalue(independence_test(y ~ arm | stratum, data = data,
                                  distribution = approximate(nresample = RESAMPLES), alternative = "less"))
    list(id = t$id, p = as.numeric(p), method = "approximate", resamples = RESAMPLES)
  }
})
out <- list(oracle = paste("R", paste(R.version$major, R.version$minor, sep = "."), "coin", as.character(packageVersion("coin"))),
            results = results)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "test/stats/reference-coin-score-permutation.json")
cat("ok\n")
