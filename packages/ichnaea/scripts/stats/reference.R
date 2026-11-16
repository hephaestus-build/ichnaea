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
eq <- list()
unequal <- list(
  list(x1 = c(2, 1, 6, 5), n1 = c(2, 2, 6, 6), x2 = c(2, 2, 6, 4), n2 = c(2, 2, 6, 6)),
  list(x1 = c(1, 3, 2, 9), n1 = c(2, 3, 2, 10), x2 = c(2, 3, 1, 10), n2 = c(2, 3, 2, 10))
)
for (st in c(sets, unequal)) for (lv in c(0.95, 0.90)) {
  r <- scoreci(x1 = st$x1, n1 = st$n1, x2 = st$x2, n2 = st$n2, contrast = "RD", stratified = TRUE, wt = rep(1, length(st$x1)), level = lv, skew = FALSE, bcf = TRUE, precis = 12, warn = FALSE)
  eq[[length(eq) + 1]] <- c(st, list(level = lv, skew = FALSE, bcf = TRUE, weights = "equal"), est(r))
}
out$stratifiedEqual <- eq
t <- list()
for (tab in list(c(30,5,2,3), c(20,0,0,0), c(10,3,3,4), c(0,5,0,0), c(43,0,1,0), c(50,4,9,7), c(1,1,1,1)))
  for (lv in c(0.95, 0.90)) for (sk in c(FALSE, TRUE)) {
    r <- suppressWarnings(pairbinci(x = tab, contrast = "RD", method = "Score", level = lv, skew = sk, bcf = FALSE, precis = 12, warn = FALSE))
    t[[length(t) + 1]] <- list(both = tab[1], candidateOnly = tab[2], baseOnly = tab[3], neither = tab[4], level = lv, skew = sk, lower = unname(r$estimates[1,"lower"]), estimate = unname(r$estimates[1,"est"]), upper = unname(r$estimates[1,"upper"]))
  }
out$tango <- t
pv <- list()
psets <- list(
  list(x1 = c(2,1,2,2,0,2), n1 = rep(2,6), x2 = c(2,2,2,1,2,2), n2 = rep(2,6)),
  list(x1 = c(3,2,3,1,3,3,2,3), n1 = rep(3,8), x2 = c(3,3,3,3,2,3,3,3), n2 = rep(3,8)),
  list(x1 = rbinom(40, 2, 0.85), n1 = rep(2,40), x2 = rbinom(40, 2, 0.9), n2 = rep(2,40)),
  list(x1 = rbinom(25, 3, 0.6), n1 = rep(3,25), x2 = rbinom(25, 3, 0.75), n2 = rep(3,25))
)
for (st in psets) for (margin in c(0, 0.05, 0.1, 0.2)) {
  r <- scoreci(x1 = st$x1, n1 = st$n1, x2 = st$x2, n2 = st$n2, contrast = "RD", stratified = TRUE, wt = rep(1, length(st$x1)), skew = FALSE, bcf = TRUE, theta0 = -margin, level = 0.9, precis = 12, warn = FALSE)
  k <- length(st$x1)
  tab <- array(0, dim = c(2, 2, k))
  for (j in 1:k) tab[, , j] <- matrix(c(st$x1[j], st$x2[j], st$n1[j] - st$x1[j], st$n2[j] - st$x2[j]), 2, 2)
  informative <- sapply(1:k, function(j) { t <- st$x1[j] + st$x2[j]; t > 0 && t < st$n1[j] + st$n2[j] })
  exact <- if (sum(informative) >= 1) mantelhaen.test(tab[, , informative, drop = FALSE], exact = TRUE, alternative = "less")$p.value else 1
  pv[[length(pv) + 1]] <- c(st, list(margin = margin, nonInferiorityP = unname(r$pval[1, "pval_right"]), lower90 = unname(r$estimates[1, "lower"]), regressionP = exact))
}
out$pvalues <- pv
ta <- list()
for (n in c(10, 25)) for (b in 0:n) for (c in 0:(n - b)) for (sk in c(FALSE, TRUE)) {
  r <- suppressWarnings(pairbinci(x = c(n - b - c, b, c, 0), contrast = "RD", method = "Score", level = 0.9, skew = sk, bcf = FALSE, precis = 12, warn = FALSE))
  ta[[length(ta) + 1]] <- list(n = n, candidateOnly = b, baseOnly = c, skew = sk, lower = unname(r$estimates[1, "lower"]), upper = unname(r$estimates[1, "upper"]))
}
out$tangoAll <- ta
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "/w/reference.json")
cat("ok\n")
