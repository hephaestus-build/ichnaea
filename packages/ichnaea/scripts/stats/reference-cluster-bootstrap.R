# Test-only oracle. Base R suffices. Run from packages/stats in the pinned R image used by CI.
# The output contains synthetic values, R's actual cluster draws, and full-precision type-7 bounds.
fixtures <- list(
  binary = list(a = c(0, 1), b = c(1, 1), c = c(0, 0), d = c(1, 0)),
  unequal = list(a = c(0, 0, 0, 1, 0), b = c(1), c = c(0.25, 0.75)),
  missing = list(a = c(NA, NA), b = c(1), c = c(0, NA)),
  paired = list(a = c(-1, 0), b = c(1, 1), c = c(0, 0), d = c(-1, 1)),
  constant = list(a = c(1, 1), b = c(1), c = c(1, 1, 1))
)
seed <- 731L
resamples <- 257L
level <- 0.95
number <- function(value) sprintf("%.17g", value)
rows <- lapply(names(fixtures), function(name) {
  groups <- fixtures[[name]]
  set.seed(seed)
  draws <- replicate(resamples, sample(seq_along(groups), length(groups), replace = TRUE), simplify = FALSE)
  values <- vapply(draws, function(draw) mean(unlist(groups[draw]), na.rm = TRUE), 0)
  bounds <- quantile(values, c((1 - level) / 2, 1 - (1 - level) / 2), names = FALSE, na.rm = TRUE, type = 7)
  data.frame(
    fixture = name,
    clusters = paste(names(groups), collapse = ","),
    values = paste(vapply(groups, function(group) paste(ifelse(is.na(group), "NA", number(group)), collapse = ","), ""), collapse = ";"),
    seed = seed, resamples = resamples, level = number(level),
    estimate = number(mean(unlist(groups), na.rm = TRUE)),
    lower = number(bounds[1]), upper = number(bounds[2]), omitted = sum(is.na(values)),
    draws = paste(vapply(draws, function(draw) paste(draw - 1L, collapse = ","), ""), collapse = ";")
  )
})
write.table(do.call(rbind, rows), "test/stats/reference-cluster-bootstrap.tsv", sep = "\t", row.names = FALSE, quote = FALSE)
