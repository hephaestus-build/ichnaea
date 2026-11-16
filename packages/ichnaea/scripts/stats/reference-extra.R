# Writes test/stats/reference-r-extra.json: reference values that need no simulated input. Test-only oracle,
# on R 4.5.2 with ratesci and jsonlite from a dated CRAN snapshot. Run in a container:
#   docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w rocker/r-ver:4.5.2 Rscript scripts/stats/reference-extra.R
repos <- "https://packagemanager.posit.co/cran/__linux__/noble/2026-11-01"
dir.create("/tmp/rlib", showWarnings = FALSE)
.libPaths(c("/tmp/rlib", .libPaths()))
suppressMessages(install.packages(c("ratesci", "jsonlite"), lib = "/tmp/rlib", repos = repos, quiet = TRUE))
suppressMessages({ library(ratesci); library(jsonlite) })

# 1. R's exact Mantel-Haenszel test (alternative "less") with unequal arms in some strata.
exact <- function(x1, n1, x2, n2) {
  k <- length(x1)
  tab <- array(0, dim = c(2, 2, k))
  for (j in 1:k) tab[, , j] <- matrix(c(x1[j], x2[j], n1[j] - x1[j], n2[j] - x2[j]), 2, 2)
  informative <- sapply(1:k, function(j) { t <- x1[j] + x2[j]; t > 0 && t < n1[j] + n2[j] })
  if (sum(informative) == 0) return(1)
  mantelhaen.test(tab[, , informative, drop = FALSE], exact = TRUE, alternative = "less")$p.value
}
unequal <- list(
  list(x1 = c(1, 2, 0, 3), n1 = c(2, 3, 2, 5), x2 = c(2, 2, 1, 4), n2 = c(3, 2, 2, 4)),
  list(x1 = c(0, 1, 1, 2, 2), n1 = c(1, 2, 3, 2, 4), x2 = c(2, 3, 2, 2, 3), n2 = c(3, 3, 2, 2, 5)),
  list(x1 = c(2, 2, 1, 0, 3, 1), n1 = c(2, 4, 2, 3, 3, 2), x2 = c(2, 3, 2, 2, 3, 2), n2 = c(3, 3, 2, 2, 5, 2)),
  list(x1 = c(5, 4, 3), n1 = c(5, 5, 4), x2 = c(5, 5, 5), n2 = c(6, 5, 5))
)
out <- list(meta = list(r = R.version.string, ratesci = as.character(packageVersion("ratesci"))))
out$exactUnequal <- lapply(unequal, function(s) c(s, list(p = exact(s$x1, s$n1, s$x2, s$n2))))

# 2. The zero-noise floor with unequal trial counts: every trial passes in both arms. The floor is
# minus the one-sided 95% lower bound, which is the lower end of the two-sided 90% interval.
floors <- list(c(2, 3, 2, 5, 2, 3), c(2, 2, 2, 2, 2, 3, 3, 3), c(3, 3, 3, 3, 3, 3, 3, 3, 3, 2), c(5, 4, 3, 2, 2, 2, 2))
out$floors <- lapply(floors, function(n) {
  r <- scoreci(x1 = n, n1 = n, x2 = n, n2 = n, contrast = "RD", stratified = TRUE, wt = rep(1, length(n)),
               level = 0.9, skew = FALSE, bcf = TRUE, precis = 12, warn = FALSE)
  list(trials = n, floor = -unname(r$estimates[1, "lower"]))
})

# 3. Extreme tables, where the bound comes close to -1 or +1.
extremes <- list(
  list(x1 = c(0, 0, 0, 0, 0), n1 = rep(3, 5), x2 = c(3, 3, 3, 3, 3), n2 = rep(3, 5)),
  list(x1 = c(0, 0, 0, 0, 0, 0, 0, 0), n1 = rep(2, 8), x2 = rep(2, 8), n2 = rep(2, 8)),
  list(x1 = c(3, 3, 3, 3, 3), n1 = rep(3, 5), x2 = c(0, 0, 0, 0, 0), n2 = rep(3, 5)),
  list(x1 = c(0, 0, 0, 0, 1), n1 = rep(4, 5), x2 = c(4, 4, 4, 4, 4), n2 = rep(4, 5)),
  # Bounds within 1e-3 of -1 and +1, where the score function's clamp at the edge matters.
  list(x1 = c(0, 0, 0, 0, 1), n1 = rep(50, 5), x2 = rep(50, 5), n2 = rep(50, 5)),
  list(x1 = c(0, 0, 0, 1, 1), n1 = rep(200, 5), x2 = rep(200, 5), n2 = rep(200, 5)),
  list(x1 = c(1, 0, 0, 0, 0, 0), n1 = rep(30, 6), x2 = rep(30, 6), n2 = rep(30, 6)),
  list(x1 = rep(50, 5), n1 = rep(50, 5), x2 = c(0, 0, 0, 0, 1), n2 = rep(50, 5))
)
out$extremes <- unlist(lapply(extremes, function(s) lapply(c(0.95, 0.9), function(lv) {
  r <- scoreci(x1 = s$x1, n1 = s$n1, x2 = s$x2, n2 = s$n2, contrast = "RD", stratified = TRUE, wt = rep(1, length(s$x1)),
               level = lv, skew = FALSE, bcf = TRUE, precis = 12, warn = FALSE)
  c(s, list(level = lv, lower = unname(r$estimates[1, "lower"]), upper = unname(r$estimates[1, "upper"])))
})), recursive = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "test/stats/reference-r-extra.json")
cat("ok\n")
