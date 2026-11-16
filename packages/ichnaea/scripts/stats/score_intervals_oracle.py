"""Test-only oracle for the score non-inferiority bound S-B (and phiHat, the estimate), written
independently of the TypeScript from a formula-only specification. The repository's tables hold
integer units over the table's denominator.

Usage, in the pinned Python image:
  python scripts/stats/score_intervals_oracle.py test/stats/reference-score-permutation-tables.json \
    test/stats/reference-python-score-intervals.json

The restricted MLE is found by bisection on the profile score, not by the
closed-form cubic that the R oracle uses, so the two oracles share no code path.
"""

import json
import math
import platform
import sys
from statistics import NormalDist

import numpy as np

Z95 = NormalDist().inv_cdf(0.95)
PHI_MIN = {"0": 0.0, "0.01": 0.01, "0.02": 0.02, "0.05": 0.05, "0.1": 0.1}


def restricted_mle(sc, nc, sb, nb, delta):
    """Vectorised over cases: maximise the binomial log-likelihood subject to
    p_C - p_B = delta. The log-likelihood is concave in p_C, so its derivative
    decreases on the open feasible interval; bisect on its sign. Only interior
    points are evaluated, so a boundary maximiser is the limit of the bisection."""
    lo = np.full(sc.shape, max(0.0, delta))
    hi = np.full(sc.shape, min(1.0, 1.0 + delta))
    for _ in range(80):
        p = 0.5 * (lo + hi)
        q = p - delta
        g = sc / p - (nc - sc) / (1.0 - p) + sb / q - (nb - sb) / (1.0 - q)
        up = g > 0
        lo = np.where(up, p, lo)
        hi = np.where(up, hi, p)
    p = 0.5 * (lo + hi)
    return p, p - delta


def score_bound(sc, nc, sb, nb, dhat, phi):
    if phi == 0:
        return dhat
    k = len(sc)
    corr = (nc + nb) / (nc + nb - 1.0)

    def f(delta):
        pc, pb = restricted_mle(sc, nc, sb, nb, delta)
        v = float(np.sum((pc * (1 - pc) / nc + pb * (1 - pb) / nb) * corr)) / k**2
        num = dhat - delta
        if v == 0:
            return math.inf if num > 0 else -math.inf
        return num / math.sqrt(phi * v) - Z95

    lo, hi = -1.0, dhat
    while hi - lo > 1e-15:
        mid = 0.5 * (lo + hi)
        if mid <= lo or mid >= hi:
            break
        if f(mid) >= 0:
            lo = mid
        else:
            hi = mid
    return -1.0 if lo == -1.0 else 0.5 * (lo + hi)


def analyse(tab):
    cells_c, cells_b = [], []
    for case in tab["cases"]:
        if not case["candidate"] or not case["base"]:
            continue
        cells_c.append(np.asarray(case["candidate"], dtype=float) / tab["denominator"])
        cells_b.append(np.asarray(case["base"], dtype=float) / tab["denominator"])
    k = len(cells_c)
    nc = np.array([len(y) for y in cells_c], dtype=float)
    nb = np.array([len(y) for y in cells_b], dtype=float)
    sc = np.array([math.fsum(y) for y in cells_c])
    sb = np.array([math.fsum(y) for y in cells_b])
    dhat = math.fsum(sc / nc - sb / nb) / k

    num = den = 0.0
    df = 0
    for y in cells_c + cells_b:
        n = len(y)
        df += n - 1
        if n < 2:
            continue
        m = math.fsum(y) / n
        ss = math.fsum((y - m) ** 2)
        num += ss
        den += (n - 1) * m * (1 - m) + ss / n
    phi_hat = 1.0 if den == 0 else num / den

    sb_bounds = {key: score_bound(sc, nc, sb, nb, dhat, max(phi_hat, pm)) for key, pm in PHI_MIN.items()}
    return {"id": tab["id"], "estimate": dhat, "phiHat": phi_hat, "sa": None, "sb": sb_bounds,
            "sc": None, "df": df}


def main(argv):
    with open(argv[1]) as f:
        tables = json.load(f)["tables"]
    out = {
        "oracle": f"Python {platform.python_version()} numpy {np.__version__}",
        "results": [analyse(t) for t in tables],
    }
    with open(argv[2], "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    # At a converged boundary maximiser, p can round onto 0 or 1; the resulting
    # inf or nan in the score only ever moves the bracket the right way.
    with np.errstate(divide="ignore", invalid="ignore"):
        main(sys.argv)
