# Reference Krippendorff's alpha (nominal, ordinal, interval) in base R.
#
# Source: K. Krippendorff, "Computing Krippendorff's Alpha-Reliability" (2011),
# https://repository.upenn.edu/asc_papers/43/. Comments cite its steps:
#   A. the reliability data matrix: m observers x N units, values or blanks;
#   B. the coincidence matrix o_ck: each pairable unit u (m_u >= 2 values)
#      adds (number of c-k pairs in u) / (m_u - 1); marginals n_c = sum_k o_ck,
#      n = sum_c n_c (the number of pairable values);
#   C. alpha = 1 - D_o / D_e = 1 - (n - 1) * sum o_ck d2_ck / sum n_c n_k d2_ck,
#      with the difference function d2 chosen by the metric.
#
# Test-only oracle. It was written from that definition alone, by an author who had not seen
# Ichnaea's TypeScript implementation, so it is an independent second source beside irr. Base R
# only: no package, so it runs in the pinned R image without network. Run from packages/ichnaea:
#   Rscript scripts/stats/reference-base-r-alpha.R test/stats/reference-alpha-units.tsv test/stats/reference-base-r-alpha.tsv

args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2)

cells <- read.delim(args[1], colClasses = c("character", "character", "character", "numeric"))

alpha_for <- function(cells) {
  # Step A: drop blanks (missing values). The value set is the sorted distinct
  # values that remain.
  cells <- cells[!is.na(cells$value), ]
  values <- sort(unique(cells$value))

  # Step B: coincidence matrix. Within a unit with m_u values, every ordered
  # pair of values from different observers counts 1 / (m_u - 1).
  o <- matrix(0, length(values), length(values))
  for (unit_values in split(cells$value, cells$unit)) {
    m_u <- length(unit_values)
    if (m_u < 2) next  # a unit with fewer than two values is not pairable
    t_u <- tabulate(match(unit_values, values), nbins = length(values))
    o <- o + (outer(t_u, t_u) - diag(t_u, length(values))) / (m_u - 1)
  }
  n_c <- rowSums(o)
  n <- sum(n_c)

  # Step C: difference functions over the value set.
  same <- outer(values, values, "==")
  delta_nominal <- 1 - same                         # 0 if c == k, else 1
  delta_interval <- outer(values, values, "-")^2    # (c - k)^2
  # Ordinal: (sum_{g=c}^{k} n_g - (n_c + n_k) / 2)^2, built from the
  # marginal frequencies of the ranked values, not from the values themselves.
  cum <- cumsum(n_c)
  delta_ordinal <- outer(seq_along(values), seq_along(values), function(c, k) {
    lo <- pmin(c, k)
    hi <- pmax(c, k)
    (cum[hi] - c(0, cum)[lo] - (n_c[c] + n_c[k]) / 2)^2
  })

  alpha <- function(delta) {
    if (n == 0) return(NaN)                 # nothing pairable
    observed <- sum(o * delta)              # n * D_o
    expected <- sum(outer(n_c, n_c) * delta) / (n - 1)  # n * D_e
    if (expected == 0) return(NaN)          # no disagreement is expected
    1 - observed / expected
  }
  c(nominal = alpha(delta_nominal), ordinal = alpha(delta_ordinal), interval = alpha(delta_interval))
}

ids <- unique(cells$matrix)  # order of first appearance
rows <- lapply(ids, function(id) alpha_for(cells[cells$matrix == id, ]))
out <- data.frame(matrix = ids, do.call(rbind, lapply(rows, function(r) sprintf("%.17g", r))))
names(out) <- c("matrix", "nominal", "ordinal", "interval")
write.table(out, args[2], sep = "\t", quote = FALSE, row.names = FALSE)
