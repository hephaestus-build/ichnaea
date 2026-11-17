# Test-only oracle for the one-arm estimates, censoring and missingness.
# Base R and the recommended package survival suffice. Run from packages/ichnaea in the pinned R
# image used by CI:
#   Rscript scripts/stats/reference-estimate.R
# It writes test/stats/reference-r-estimate.json with full-precision values:
# - Clopper–Pearson bounds from binom.test, two-sided and one-sided;
# - weighted Kaplan–Meier curves, quantiles and restricted means from survival::survfit;
# - one-sided exact stratified conditional p-values from mantelhaen.test(exact = TRUE);
# - the uncorrected Mantel-Haenszel statistic, the overdispersion z squared, and qchisq;
# - the intraclass correlation from aov's mean squares.
suppressPackageStartupMessages(library(survival))
number <- function(value) sprintf("%.17g", value)
numbers <- function(values) paste0("[", paste(vapply(values, number, ""), collapse = ","), "]")

counts <- list(c(0, 1), c(1, 1), c(0, 5), c(3, 20), c(7, 20), c(10, 20), c(19, 20), c(20, 20),
               c(1, 60), c(31, 60), c(0, 299), c(2, 299), c(150, 299), c(4, 1000), c(997, 1000),
               c(0, 2995), c(1, 4610))
levels <- c(0.95, 0.9, 0.975)
cp <- character()
for (count in counts) for (level in levels) {
  x <- count[1]
  n <- count[2]
  two <- binom.test(x, n, conf.level = level)$conf.int
  lower <- binom.test(x, n, alternative = "greater", conf.level = level)$conf.int[1]
  upper <- binom.test(x, n, alternative = "less", conf.level = level)$conf.int[2]
  cp <- c(cp, sprintf(
    '{"successes":%d,"trials":%d,"level":%s,"two":%s,"lower":%s,"upper":%s}',
    x, n, number(level), numbers(two), number(lower), number(upper)))
}

# The samples include curves that sit exactly on 1 - q over an interval, where the quantile is the
# interval's midpoint, and one (all-censored-late at q = 0.4) that sits on it to the end.
samples <- list(
  list(name = "ties", time = c(1, 2, 2, 3, 4, 5, 5, 7), status = c(1, 1, 0, 1, 0, 1, 1, 0),
       weight = rep(1, 8), limit = 7),
  list(name = "censored-at-limit", time = c(0.4, 1.3, 2.2, 6, 6, 6, 3.1, 0.9, 6),
       status = c(1, 1, 1, 0, 0, 0, 1, 1, 0), weight = rep(1, 9), limit = 6),
  list(name = "weighted", time = c(1, 3, 2, 2.5, 4, 4, 0.5), status = c(1, 1, 1, 0, 1, 0, 1),
       weight = c(0.5, 0.5, 1, 1 / 3, 1 / 3, 1 / 3, 1), limit = 4),
  list(name = "all-censored-late", time = c(5, 5, 5, 1, 2), status = c(0, 0, 0, 1, 1),
       weight = rep(1, 5), limit = 5)
)
probs <- c(0.1, 0.25, 0.37, 0.4, 0.5, 0.66, 0.9)
km <- character()
for (s in samples) {
  fit <- survfit(Surv(s$time, s$status) ~ 1, weights = s$weight)
  event <- fit$n.event > 0
  q <- quantile(fit, probs = probs, conf.int = FALSE)
  rmean <- summary(fit, rmean = s$limit)$table[["rmean"]]
  km <- c(km, sprintf(
    paste0('{"name":"%s","time":%s,"censored":%s,"weight":%s,"limit":%s,"steps":{"time":%s,',
           '"atRisk":%s,"events":%s,"survival":%s},"probs":%s,"quantiles":[%s],"rmean":%s}'),
    s$name, numbers(s$time), paste0("[", paste(ifelse(s$status == 0, "true", "false"), collapse = ","), "]"),
    numbers(s$weight), number(s$limit), numbers(fit$time[event]), numbers(fit$n.risk[event]),
    numbers(fit$n.event[event]), numbers(fit$surv[event]), numbers(probs),
    paste(ifelse(is.na(q), "null", vapply(q, number, "")), collapse = ","), number(rmean)))
}

# Missing trials per case and arm: planned and missing, base then candidate.
tables <- list(
  list(base = c(0, 0, 1), candidate = c(2, 1, 1), planned = c(3, 3, 3)),
  list(base = c(1, 0, 0, 2, 0), candidate = c(0, 0, 3, 2, 1), planned = c(4, 4, 4, 4, 4)),
  list(base = c(0, 0), candidate = c(0, 5), planned = c(10, 10))
)
mh <- character()
for (t in tables) {
  k <- length(t$planned)
  array <- array(0, dim = c(2, 2, k))
  for (i in seq_len(k)) {
    array[, , i] <- matrix(c(t$candidate[i], t$planned[i] - t$candidate[i],
                             t$base[i], t$planned[i] - t$base[i]), 2, byrow = TRUE)
  }
  less <- mantelhaen.test(array, exact = TRUE, alternative = "less")$p.value
  greater <- mantelhaen.test(array, exact = TRUE, alternative = "greater")$p.value
  mh <- c(mh, sprintf('{"base":%s,"candidate":%s,"planned":%s,"less":%s,"greater":%s}',
                      numbers(t$base), numbers(t$candidate), numbers(t$planned),
                      number(less), number(greater)))
}

# The overdispersion z of a run: R's uncorrected Mantel-Haenszel statistic is z^2.
runs <- list(
  list(candidate = c(3, 1, 0), cn = c(4, 4, 3), base = c(1, 3, 1), bn = c(4, 4, 3)),
  list(candidate = c(2, 5, 1, 0), cn = c(3, 6, 2, 2), base = c(2, 3, 2, 1), bn = c(3, 6, 2, 2)),
  list(candidate = c(9, 4), cn = c(10, 10), base = c(6, 7), bn = c(10, 10))
)
cmh <- character()
for (run in runs) {
  k <- length(run$cn)
  array <- array(0, dim = c(2, 2, k))
  for (i in seq_len(k)) {
    array[, , i] <- matrix(c(run$candidate[i], run$cn[i] - run$candidate[i],
                             run$base[i], run$bn[i] - run$base[i]), 2, byrow = TRUE)
  }
  statistic <- unname(mantelhaen.test(array, correct = FALSE)$statistic)
  cmh <- c(cmh, sprintf('{"candidate":%s,"cn":%s,"base":%s,"bn":%s,"z2":%s}',
                        numbers(run$candidate), numbers(run$cn), numbers(run$base),
                        numbers(run$bn), number(statistic)))
}
chi <- character()
for (df in c(1, 2, 3, 5, 10, 30, 100)) for (p in c(0.025, 0.05, 0.5, 0.95, 0.975)) {
  chi <- c(chi, sprintf('{"df":%d,"p":%s,"q":%s}', df, number(p), number(qchisq(p, df))))
}

# The intraclass correlation by one-way ANOVA, from aov's mean squares.
icc_sets <- list(
  list(c(1, 0, 1), c(0, 0), c(1, 1, 1, 0), c(0, 1)),
  list(c(0.2, 0.4), c(0.9, 0.8, 0.7), c(0.1, 0.3, 0.2, 0.2), c(0.5, 0.6)),
  list(c(1, 1, 0, 1), c(1, 1, 1), c(0, 0, 1), c(1, 0), c(0, 0, 0, 1, 0))
)
icc <- character()
for (set in icc_sets) {
  y <- unlist(set)
  g <- factor(rep(seq_along(set), lengths(set)))
  table <- summary(aov(y ~ g))[[1]]
  msb <- table[["Mean Sq"]][1]
  msw <- table[["Mean Sq"]][2]
  n <- length(y)
  m0 <- (n - sum(lengths(set)^2) / n) / (length(set) - 1)
  rho <- (msb - msw) / (msb + (m0 - 1) * msw)
  icc <- c(icc, sprintf('{"clusters":[%s],"rho":%s}',
                        paste(vapply(set, numbers, ""), collapse = ","), number(rho)))
}

writeLines(c(
  "{",
  sprintf('  "r": "%s", "survival": "%s",', R.version.string, packageVersion("survival")),
  sprintf('  "clopperPearson": [\n    %s\n  ],', paste(cp, collapse = ",\n    ")),
  sprintf('  "kaplanMeier": [\n    %s\n  ],', paste(km, collapse = ",\n    ")),
  sprintf('  "missing": [\n    %s\n  ],', paste(mh, collapse = ",\n    ")),
  sprintf('  "mantelHaenszel": [\n    %s\n  ],', paste(cmh, collapse = ",\n    ")),
  sprintf('  "chiSquare": [\n    %s\n  ],', paste(chi, collapse = ",\n    ")),
  sprintf('  "intraclass": [\n    %s\n  ]', paste(icc, collapse = ",\n    ")),
  "}"
), "test/stats/reference-r-estimate.json")
