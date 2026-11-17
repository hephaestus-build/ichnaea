"""Test-only oracle for the one-arm estimates and reductions, written from the formulas
alone, with no code path shared with the TypeScript.

Usage, in the pinned Python image with oracle-requirements.txt installed:
  python scripts/stats/estimate_oracle.py test/stats/reference-python-estimate.json

It writes:
- the one-arm stratified score interval, by bisection in doubles at every level: each restricted
  rate on the case's own Lagrange condition (s - r p) / (p (1 - p)) = c rather than a closed-form
  root, the multiplier on the weighted mean, and each bound on the score statistic;
- Clopper-Pearson bounds by mpmath's regularised incomplete beta, a second source beside R;
- BCa intervals over top clusters, with the draws from numpy's legacy MT19937 (seeded by
  init_genrand, as Ichnaea's generator is) and the acceleration from the jackknife;
- pass^k and pass@k by exact rational arithmetic.
"""

import json
import math
import platform
import sys
from fractions import Fraction

import mpmath
import numpy as np

mpmath.mp.dps = 30


def bisect_decreasing(f, lo, hi):
    """The root of a decreasing f on [lo, hi], by bisection in doubles until the midpoint stops
    moving."""
    while True:
        mid = (lo + hi) / 2
        if mid <= lo or mid >= hi:
            return mid
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid


def restricted_rate(s, r, c):
    """The p in [0, 1] where (s - r p) / (p (1 - p)) = c: the case's Lagrange condition. The left
    side falls from +inf to -inf on (0, 1) when 0 < s < r, so bisection finds the one root."""
    if s == 0 and c >= -r:
        return 0.0
    if s == r and c <= r:
        return 1.0
    return bisect_decreasing(lambda p: (s - r * p) / (p * (1 - p)) - c, 0.0, 1.0)


def rates_at(cells, theta):
    def excess(lam):
        return sum(w * restricted_rate(s, r, lam * w) for s, r, w in cells) - theta

    lo, hi = -1.0, 1.0
    while excess(lo) < 0:
        lo *= 2
    while excess(hi) > 0:
        hi *= 2
    lam = bisect_decreasing(excess, lo, hi)
    return [restricted_rate(s, r, lam * w) for s, r, w in cells]


def lower_bound(cells, z):
    est = sum(w * s / r for s, r, w in cells)
    if est == 0:
        return 0.0

    def excess(theta):
        rates = rates_at(cells, theta)
        var = sum(w * w * p * (1 - p) / r for (s, r, w), p in zip(cells, rates))
        return (est - theta) / math.sqrt(var) - z

    return bisect_decreasing(excess, 1e-300, est)


def one_arm_score(cells, level, sided):
    p = level if sided != "two" else 1 - (1 - level) / 2
    z = normal_quantile(p)
    flipped = [(r - s, r, w) for s, r, w in cells]
    lower = 0.0 if sided == "upper" else lower_bound(cells, z)
    upper = 1.0 if sided == "lower" else 1 - lower_bound(flipped, z)
    return [lower, upper]


def clopper_pearson(x, n, level):
    tail = (1 - mpmath.mpf(level)) / 2

    def invert(f, target):
        lo, hi = mpmath.mpf(0), mpmath.mpf(1)
        for _ in range(140):
            mid = (lo + hi) / 2
            if f(mid) < target:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    lower = 0 if x == 0 else invert(lambda p: mpmath.betainc(x, n - x + 1, 0, p, regularized=True), tail)
    upper = 1 if x == n else invert(lambda p: mpmath.betainc(x + 1, n - x, 0, p, regularized=True), 1 - tail)
    return [float(lower), float(upper)]


def normal_cdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


def normal_quantile(p):
    return float(mpmath.sqrt(2) * mpmath.erfinv(2 * mpmath.mpf(p) - 1))


def type7(sorted_values, p):
    position = (len(sorted_values) - 1) * p
    below = sorted_values[math.floor(position)]
    above = sorted_values[math.ceil(position)]
    return below + (above - below) * (position - math.floor(position))


def bca(clusters, weighting, seed, resamples, level):
    ids = sorted(clusters)  # code-point order equals UTF-16 order for these ASCII IDs
    groups = [clusters[i] for i in ids]
    g = len(groups)

    def stat(indices):
        if weighting == "per-case":
            return sum(sum(groups[i]) for i in indices) / sum(len(groups[i]) for i in indices)
        return sum(sum(groups[i]) / len(groups[i]) for i in indices) / len(indices)

    est = stat(range(g))
    state = np.random.RandomState(seed)
    draws = sorted(
        stat([int(math.floor(state.random_sample() * g)) for _ in range(g)]) for _ in range(resamples)
    )
    # A resampled estimate within rounding of the estimate counts half.
    tol = 1e-12 * max(1, abs(est))
    below = sum(1 for d in draws if d < est - tol)
    ties = sum(1 for d in draws if abs(d - est) <= tol)
    z0 = normal_quantile((below + 0.5 * ties) / resamples)
    jack = [stat([i for i in range(g) if i != left]) for left in range(g)]
    centre = sum(jack) / g
    d = [centre - v for v in jack]
    squares = sum(x * x for x in d)
    a = 0.0 if squares == 0 else sum(x ** 3 for x in d) / (6 * squares ** 1.5)
    tail = (1 - level) / 2

    def adjusted(z):
        return normal_cdf(z0 + (z0 + z) / (1 - a * (z0 + z)))

    return {
        "estimate": est,
        "lower": type7(draws, adjusted(normal_quantile(tail))),
        "upper": type7(draws, adjusted(normal_quantile(1 - tail))),
        "z0": z0,
        "acceleration": a,
    }


def reductions(values, k):
    r, c = len(values), sum(values)
    all_k = Fraction(math.comb(c, k), math.comb(r, k))
    any_k = 1 - Fraction(math.comb(r - c, k), math.comb(r, k))
    return {"all": float(all_k), "any": float(any_k)}


SCORE_FIXTURES = [
    ("single", [(3, 4, 1)]),
    ("binary-equal", [(0, 2, 0.25), (1, 2, 0.25), (2, 2, 0.25), (1, 2, 0.25)]),
    ("binary-mixed-r", [(2, 3, 0.2), (0, 2, 0.2), (3, 3, 0.2), (1, 2, 0.2), (2, 3, 0.2)]),
    ("score-fractional", [(1.25, 2, 1 / 3), (0.4, 3, 1 / 3), (1.9, 2, 1 / 3)]),
    ("family-weights", [(1, 2, 0.5), (2, 2, 0.125), (0, 2, 0.125), (1, 3, 0.125), (2, 3, 0.125)]),
    ("near-zero", [(0, 3, 0.25), (0, 3, 0.25), (0, 3, 0.25), (1, 3, 0.25)]),
    ("near-one", [(3, 3, 0.25), (3, 3, 0.25), (2.5, 3, 0.25), (3, 3, 0.25)]),
    ("all-zero", [(0, 2, 0.5), (0, 3, 0.5)]),
    ("wide", [(i % 3, 2, 1 / 30) for i in range(30)]),
]
SCORE_SETTINGS = [(0.95, "two"), (0.9, "two"), (0.95, "lower"), (0.95, "upper")]
CP_COUNTS = [(0, 1), (1, 3), (3, 20), (7, 20), (19, 20), (31, 60), (2, 299), (4, 1000)]


def clusters_fixture(name, g, seed):
    """Cases per cluster cycle through 1, 2 and 3; case means are multiples of 1/2 or 1/3."""
    clusters = {}
    for i in range(g):
        size = 1 + i % 3
        clusters[f"{name}-{i:02d}"] = [((i * 7 + j * 3 + seed) % 7) / 6 for j in range(size)]
    return clusters


def ties_fixture(g):
    """Half the clusters at 0 and half at 1: about 14% of the resampled means at 30 clusters equal
    the estimate exactly."""
    return {f"ties-{i:02d}": [float(i % 2)] for i in range(g)}


BCA_FIXTURES = [
    ("ties", 30, 5, 4000, "per-case"),
    ("thirty", 30, 11, 2000, "per-case"),
    ("thirty-family", 30, 11, 2000, "per-family"),
    ("forty-five", 45, 4242, 3000, "per-case"),
]


def main():
    out = sys.argv[1]
    score = []
    for name, cells in SCORE_FIXTURES:
        for level, sided in SCORE_SETTINGS:
            score.append(
                {
                    "name": name,
                    "cells": [{"sum": s, "trials": r, "weight": w} for s, r, w in cells],
                    "level": level,
                    "sided": sided,
                    "bounds": one_arm_score(cells, level, sided),
                }
            )
    cp = [
        {"successes": x, "trials": n, "level": level, "two": clopper_pearson(x, n, level)}
        for x, n in CP_COUNTS
        for level in (0.95, 0.9)
    ]
    bcas = []
    for name, g, seed, resamples, weighting in BCA_FIXTURES:
        clusters = ties_fixture(g) if name == "ties" else clusters_fixture(name, g, seed)
        bcas.append(
            {
                "name": name,
                "clusters": [{"id": i, "caseMeans": m} for i, m in clusters.items()],
                "weighting": weighting,
                "seed": seed,
                "resamples": resamples,
                "level": 0.95,
                **bca(clusters, weighting, seed, resamples, 0.95),
            }
        )
    reduced = []
    for values in ([1, 0, 1, 0], [1, 1, 0, 1, 0, 1, 1], [0, 0, 0, 1, 0], [1] * 5 + [0] * 5):
        for k in range(1, len(values) + 1):
            reduced.append({"values": values, "k": k, **reductions(values, k)})
    with open(out, "w") as handle:
        json.dump(
            {
                "python": platform.python_version(),
                "mpmath": mpmath.__version__,
                "numpy": np.__version__,
                "oneArmScore": score,
                "clopperPearson": cp,
                "bca": bcas,
                "reductions": reduced,
            },
            handle,
            indent=1,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
