.libPaths(c("/w/rlib", .libPaths())); suppressMessages({library(ratesci); library(jsonlite)})
out <- list(meta = list(oracle = "ratesci", version = as.character(packageVersion("ratesci")), r = R.version.string))
est <- function(r) { e <- r$estimates; list(lower = unname(e[1, "lower"]), estimate = unname(e[1, "est"]), upper = unname(e[1, "upper"])) }
w <- list()
for (xn in list(c(0,10), c(1,10), c(5,10), c(10,10), c(81,263), c(15,148), c(0,20), c(1,29), c(29,29), c(3,7), c(250,300)))
  for (lv in c(0.95, 0.90)) {
    r <- scoreci(x1 = xn[1], n1 = xn[2], contrast = "p", distrib = "bin", level = lv, skew = FALSE, bcf = FALSE, precis = 12, warn = FALSE)
    w[[length(w) + 1]] <- c(list(x = xn[1], n = xn[2], level = lv), est(r))
  }
out$wilson <- w
d <- list()
for (q in list(c(5,10,3,10), c(56,70,48,80), c(9,10,3,10), c(10,10,10,10), c(0,10,0,10), c(10,10,0,10), c(0,10,10,10), c(2,2,1,2), c(1,2,2,2), c(44,60,47,60), c(117,120,118,120)))
  for (lv in c(0.95, 0.90)) for (sk in c(FALSE, TRUE)) for (bc in c(FALSE, TRUE)) {
    r <- scoreci(x1 = q[1], n1 = q[2], x2 = q[3], n2 = q[4], contrast = "RD", level = lv, skew = sk, bcf = bc, precis = 12, warn = FALSE)
    d[[length(d) + 1]] <- c(list(x1 = q[1], n1 = q[2], x2 = q[3], n2 = q[4], level = lv, skew = sk, bcf = bc), est(r))
  }
out$difference <- d
set.seed(20261115)
sets <- list(
  list(x1 = c(2,1,2), n1 = c(2,2,2), x2 = c(2,2,1), n2 = c(2,2,2)),
  list(x1 = rep(2,20), n1 = rep(2,20), x2 = rep(2,20), n2 = rep(2,20)),
  list(x1 = c(rep(2,15), 1, 1, 0, 2, 2), n1 = rep(2,20), x2 = c(rep(2,15), 2, 1, 1, 1, 2), n2 = rep(2,20)),
  list(x1 = rbinom(30, 3, 0.8), n1 = rep(3,30), x2 = rbinom(30, 3, 0.8), n2 = rep(3,30)),
  list(x1 = rbinom(60, 2, 0.9), n1 = rep(2,60), x2 = rbinom(60, 2, 0.9), n2 = rep(2,60)),
  list(x1 = c(8,5,9), n1 = c(10,8,12), x2 = c(6,6,7), n2 = c(10,9,11))
)
s <- list()
for (st in sets) for (lv in c(0.95, 0.90)) for (sk in c(FALSE, TRUE)) for (bc in c(FALSE, TRUE)) {
  r <- scoreci(x1 = st$x1, n1 = st$n1, x2 = st$x2, n2 = st$n2, contrast = "RD", stratified = TRUE, weighting = "MH", level = lv, skew = sk, bcf = bc, precis = 12, warn = FALSE)
  s[[length(s) + 1]] <- c(st, list(level = lv, skew = sk, bcf = bc), est(r))
}
out$stratified <- s
t <- list()
for (tab in list(c(30,5,2,3), c(20,0,0,0), c(10,3,3,4), c(0,5,0,0), c(43,0,1,0), c(50,4,9,7), c(1,1,1,1)))
  for (lv in c(0.95, 0.90)) for (sk in c(FALSE, TRUE)) {
    r <- suppressWarnings(pairbinci(x = tab, contrast = "RD", method = "Score", level = lv, skew = sk, bcf = FALSE, precis = 12, warn = FALSE))
    t[[length(t) + 1]] <- list(both = tab[1], candidateOnly = tab[2], baseOnly = tab[3], neither = tab[4], level = lv, skew = sk, lower = unname(r$estimates[1,"lower"]), estimate = unname(r$estimates[1,"est"]), upper = unname(r$estimates[1,"upper"]))
  }
out$tango <- t
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "/w/reference.json")
cat("ok\n")
