# Test-only oracle for the score non-inferiority bounds S-A, S-B and S-C, written independently of the
# TypeScript from a formula-only specification. Reads test/stats/reference-score-permutation-tables.json and
# writes test/stats/reference-r-score-intervals.json. Base R plus jsonlite. Run in a container:
#   docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w rocker/r-ver:4.5.2 Rscript scripts/stats/reference-score-intervals.R \
#     test/stats/reference-score-permutation-tables.json test/stats/reference-r-score-intervals.json

local({
  lib <- "/tmp/rlib"
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
  if (!requireNamespace("jsonlite", quietly = TRUE) || !requireNamespace("ratesci", quietly = TRUE)) {
    repos <- "https://packagemanager.posit.co/cran/__linux__/noble/2026-11-01"
    dir.create(lib, showWarnings = FALSE)
    .libPaths(c(lib, .libPaths()))
    install.packages(c("jsonlite", "ratesci"), lib = lib, repos = repos, quiet = TRUE)
  }
})
library(jsonlite)
suppressMessages(library(ratesci))

Z95 <- qnorm(0.95)
PHI_MIN <- c("0" = 0, "0.01" = 0.01, "0.02" = 0.02, "0.05" = 0.05, "0.1" = 0.1)

# Restricted MLE (p_C, p_B) with p_C - p_B = delta, closed form of
# Miettinen-Nurminen / Farrington-Manning. x1 = S_C, n1 = n_C, x2 = S_B, n2 = n_B.
restricted_mle <- function(x1, n1, x2, n2, delta) {
  p1 <- x1 / n1
  p2 <- x2 / n2
  theta <- n2 / n1
  a <- 1 + theta
  b <- -(1 + theta + p1 + theta * p2 + delta * (theta + 2))
  c <- delta^2 + delta * (2 * p1 + theta + 1) + p1 + theta * p2
  d <- -p1 * delta * (1 + delta)
  v <- b^3 / (3 * a)^3 - b * c / (6 * a^2) + d / (2 * a)
  q <- b^2 / (3 * a)^2 - c / (3 * a)
  if (q <= 0) {
    pt1 <- -b / (3 * a)
  } else {
    u <- (if (v < 0) -1 else 1) * sqrt(q)
    w <- (pi + acos(min(1, max(-1, v / u^3)))) / 3
    pt1 <- 2 * u * cos(w) - b / (3 * a)
  }
  pt1 <- min(min(1, 1 + delta), max(max(0, delta), pt1))
  c(pt1, pt1 - delta)
}

loglik <- function(pc, x1, n1, x2, n2, delta) {
  pb <- pc - delta
  t <- function(s, p) if (s == 0) 0 else s * log(p)
  t(x1, pc) + t(n1 - x1, 1 - pc) + t(x2, pb) + t(n2 - x2, 1 - pb)
}

score_fn <- function(pc, x1, n1, x2, n2, delta) {
  pb <- pc - delta
  x1 / pc - (n1 - x1) / (1 - pc) + x2 / pb - (n2 - x2) / (1 - pb)
}

# optimize() stops at a relative x tolerance of about sqrt(eps), so a second
# call zooms into a 2e-6 window around the first answer, reparametrised to t.
optimize_zoom <- function(f, lo, hi) {
  p0 <- optimize(f, c(lo, hi), tol = 1e-15)$minimum
  w <- 1e-6
  tl <- max(-1, (lo - p0) / w); tu <- min(1, (hi - p0) / w)
  p0 + w * optimize(function(t) f(p0 + w * t), c(tl, tu), tol = 1e-15)$minimum
}

# Self-check: closed form against optimize().
# (a) optimize() on |d loglik / d p_C|, zoomed, locates the stationary point to ~1e-14;
# (b) optimize() on -loglik can locate it only to ~sqrt(eps), because loglik
#     is flat at its maximum, so it is checked on the log-likelihood value.
self_check <- function(ncases = 30) {
  set.seed(1985)
  worst_p <- 0
  worst_ll <- 0
  for (i in seq_len(ncases)) {
    n1 <- sample(1:6, 1); n2 <- sample(1:6, 1)
    D <- sample(c(4, 10, 1000), 1)
    x1 <- sum(sample(0:D, n1, replace = TRUE)) / D
    x2 <- sum(sample(0:D, n2, replace = TRUE)) / D
    delta <- runif(1, -0.95, 0.95)
    lo <- max(0, delta); hi <- min(1, 1 + delta)
    cf <- restricted_mle(x1, n1, x2, n2, delta)
    os <- optimize_zoom(function(p) abs(score_fn(p, x1, n1, x2, n2, delta)), lo, hi)
    ol <- optimize(function(p) -loglik(p, x1, n1, x2, n2, delta), c(lo, hi), tol = 1e-15)$minimum
    worst_p <- max(worst_p, abs(cf[1] - os))
    worst_ll <- max(worst_ll, loglik(ol, x1, n1, x2, n2, delta) - loglik(cf[1], x1, n1, x2, n2, delta))
  }
  # Boundary cases: S = 0 or S = n in an arm.
  worst_b <- 0
  for (cs in list(c(0, 3, 1.5, 3, -0.2), c(0, 2, 0, 4, -0.5), c(2, 2, 1.25, 3, 0.3),
                  c(1.75, 4, 3, 3, -0.6), c(0, 1, 1, 1, -0.4), c(0, 3, 0, 3, 0.1))) {
    lo <- max(0, cs[5]); hi <- min(1, 1 + cs[5])
    cf <- restricted_mle(cs[1], cs[2], cs[3], cs[4], cs[5])
    ol <- optimize(function(p) -loglik(p, cs[1], cs[2], cs[3], cs[4], cs[5]), c(lo, hi), tol = 1e-15)$minimum
    worst_b <- max(worst_b, abs(cf[1] - ol))
  }
  message(sprintf("self-check MLE: %d random fractional cases, max |p_closed - p_optimize(|score|)| = %.3e", ncases, worst_p))
  message(sprintf("self-check MLE: max loglik(optimize) - loglik(closed) = %.3e (<= 0 means closed form is at least as good)", worst_ll))
  message(sprintf("self-check MLE: 6 boundary cases, max |p_closed - p_optimize(loglik)| = %.3e", worst_b))
  stopifnot(worst_p < 1e-10, worst_ll < 1e-12, worst_b < 1e-7)
}

cell_stats <- function(y) {
  n <- length(y); s <- sum(y); m <- s / n
  list(n = n, S = s, ybar = m, SS = sum((y - m)^2))
}

# Root of Z(delta) = z on (-1, dhat] by bisection; Z decreases in delta.
score_bound <- function(cs, dhat, phi) {
  if (phi == 0) return(dhat)
  k <- length(cs)
  f <- function(delta) {
    V <- 0
    for (x in cs) {
      p <- restricted_mle(x$C$S, x$C$n, x$B$S, x$B$n, delta)
      N <- x$C$n + x$B$n
      V <- V + (p[1] * (1 - p[1]) / x$C$n + p[2] * (1 - p[2]) / x$B$n) * N / (N - 1)
    }
    V <- V / k^2
    num <- dhat - delta
    if (V == 0) return(if (num > 0) Inf else -Inf)
    num / sqrt(phi * V) - Z95
  }
  lo <- -1; hi <- dhat
  while (hi - lo > 1e-15) {
    mid <- (lo + hi) / 2
    if (mid <= lo || mid >= hi) break
    if (f(mid) >= 0) lo <- mid else hi <- mid
  }
  if (lo == -1) return(-1)
  (lo + hi) / 2
}

analyse <- function(tab) {
  cs <- list()
  for (case in tab$cases) {
    # The repository's tables hold integer units over the table's denominator.
    yc <- as.numeric(unlist(case$candidate)) / tab$denominator; yb <- as.numeric(unlist(case$base)) / tab$denominator
    if (length(yc) == 0 || length(yb) == 0) next
    cs[[length(cs) + 1]] <- list(C = cell_stats(yc), B = cell_stats(yb))
  }
  k <- length(cs)
  dhat <- sum(vapply(cs, function(x) x$C$ybar - x$B$ybar, 0)) / k
  cells <- unlist(lapply(cs, function(x) list(x$C, x$B)), recursive = FALSE)
  multi <- Filter(function(cl) cl$n >= 2, cells)
  ss <- sum(vapply(multi, function(cl) cl$SS, 0))
  den <- sum(vapply(multi, function(cl) (cl$n - 1) * cl$ybar * (1 - cl$ybar) + cl$SS / cl$n, 0))
  phi_hat <- if (den == 0) 1 else ss / den
  df <- sum(vapply(cells, function(cl) cl$n - 1, 0))
  sc <- NA
  if (df > 0) {
    s2 <- ss / df
    se <- sqrt(sum(vapply(cs, function(x) s2 * (1 / x$C$n + 1 / x$B$n), 0))) / k
    sc <- dhat - qt(0.95, df) * se
  }
  sb <- lapply(PHI_MIN, function(pm) score_bound(cs, dhat, max(phi_hat, pm)))
  # S-A from ratesci itself: fractional counts, equal weights, the N/(N-1) factor, no skewness
  # correction. The one-sided 95% lower bound is the lower end of the two-sided 90% interval.
  sa_ratesci <- unname(suppressMessages(scoreci(
    x1 = vapply(cs, function(x) x$C$S, 0), n1 = vapply(cs, function(x) x$C$n, 0),
    x2 = vapply(cs, function(x) x$B$S, 0), n2 = vapply(cs, function(x) x$B$n, 0),
    contrast = "RD", stratified = TRUE, wt = rep(1, k), level = 0.9, skew = FALSE, bcf = TRUE,
    precis = 12, warn = FALSE))$estimates[1, "lower"])
  list(id = tab$id, estimate = dhat, phiHat = phi_hat, sa = score_bound(cs, dhat, 1), saRatesci = sa_ratesci,
       sb = sb, sc = sc, df = df)
}

main <- function(args) {
  self_check()
  input <- fromJSON(args[1], simplifyVector = FALSE)
  results <- lapply(input$tables, analyse)
  out <- list(oracle = R.version.string, results = results)
  writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, na = "null", pretty = TRUE), args[2])
}

if (sys.nframe() == 0) main(commandArgs(trailingOnly = TRUE))
