# Writes test/stats/reference-r-agreement.json: raw agreement, Cohen's kappa, Gwet's AC1 and
# Krippendorff's alpha for every input of test/stats/reference-agreement-inputs.json.
# Test-only oracle, on R 4.5.2 with irr, irrCAC and jsonlite from a dated CRAN snapshot. Run from
# packages/ichnaea in the pinned R image that CI uses:
#   docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w rocker/r-ver:4.5.2 Rscript scripts/stats/reference-agreement.R
repos <- "https://packagemanager.posit.co/cran/__linux__/noble/2026-11-01"
dir.create("/tmp/rlib", showWarnings = FALSE)
.libPaths(c("/tmp/rlib", .libPaths()))
suppressMessages(install.packages(c("irr", "irrCAC", "jsonlite"), lib = "/tmp/rlib", repos = repos, quiet = TRUE))
suppressMessages({ library(irr); library(irrCAC); library(jsonlite) })

input <- fromJSON("test/stats/reference-agreement-inputs.json", simplifyVector = FALSE)
as_matrix <- function(rows) do.call(rbind, lapply(rows, function(r) as.numeric(unlist(r))))
# The rows of a reliability matrix, with JSON null as NA.
as_units <- function(rows) do.call(rbind, lapply(rows, function(r) vapply(r, function(x) if (is.null(x)) NA_real_ else as.numeric(x), 0)))
# The two raters' labels of a table, one row per item, as irr expects them.
expand <- function(m) {
  q <- nrow(m)
  idx <- which(m > 0, arr.ind = TRUE)
  rows <- do.call(rbind, lapply(seq_len(nrow(idx)), function(k) matrix(rep(idx[k, ], m[idx[k, 1], idx[k, 2]]), ncol = 2, byrow = TRUE)))
  data.frame(a = factor(rows[, 1], levels = seq_len(q)), b = factor(rows[, 2], levels = seq_len(q)))
}

tables <- lapply(input$tables, function(t) {
  m <- as_matrix(t$table)
  list(
    id = t$id,
    raw = sum(diag(m)) / sum(m),
    # Gwet's own package, from the table.
    kappa = kappa2.table(m)$coeff.val,
    ac1 = gwet.ac1.table(m)$coeff.val,
    # irr's kappa from the items themselves, as a second source for kappa.
    kappaIrr = kappa2(expand(m))$value
  )
})

pairs <- lapply(input$pairs, function(p) {
  lab <- function(v) factor(vapply(v, function(x) if (is.null(x)) NA_character_ else x, ""), levels = unlist(p$categories))
  a <- lab(p$first)
  b <- lab(p$second)
  m <- table(a, b, useNA = "no")
  list(id = p$id, table = lapply(seq_len(nrow(m)), function(i) as.integer(m[i, ])), kappa = kappa2(data.frame(a, b))$value)
})

reliability <- lapply(input$reliability, function(r) {
  # irr wants one row per rater.
  ratings <- t(as_units(r$units))
  list(
    id = r$id,
    nominal = kripp.alpha(ratings, "nominal")$value,
    ordinal = kripp.alpha(ratings, "ordinal")$value,
    interval = kripp.alpha(ratings, "interval")$value
  )
})

writeLines(
  toJSON(list(tables = tables, pairs = pairs, reliability = reliability), auto_unbox = TRUE, digits = I(17)),
  "test/stats/reference-r-agreement.json"
)
