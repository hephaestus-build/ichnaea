"""Test-only oracle for the drift guard's detectable drift (src/stats/sentinel.ts).

Written from the definition alone: the sentinel test is the exact stratified conditional test of
fresh against stored trials, two-sided as twice the smaller one-sided p-value, and its power sums,
over every vector (n_0, ..., n_2r) of case counts at each case total, the multinomial probability
of that vector times the probability that the fresh total falls in the rejection region.

- The rejection regions use exact rational arithmetic (fractions), so they need no tolerance.
- The power uses floats with only +, * and /, never pow, so it is the same on every CPU and
  Python version; it needs only the standard library.
- The detectable drift is the smallest multiple of 0.05 with power >= 0.8, or the largest possible
  drift when only it reaches 0.8.

Usage: python scripts/stats/sentinel_drift_oracle.py test/stats/reference-python-sentinel.json
"""

import itertools
import json
import sys
from fractions import Fraction
from math import comb, factorial

LEVEL = Fraction(1, 20)
TARGET = 0.8


def compositions(total, parts):
    for cuts in itertools.combinations(range(total + parts - 1), parts - 1):
        bounds = (-1,) + cuts + (total + parts - 1,)
        yield tuple(bounds[i + 1] - bounds[i] - 1 for i in range(parts))


def polymul(a, b):
    out = [0] * (len(a) + len(b) - 1)
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            out[i + j] += x * y
    return out


def null_case(r, t):
    return [Fraction(comb(r, y) * comb(r, t - y), comb(2 * r, t)) if 0 <= t - y <= r else Fraction(0)
            for y in range(r + 1)]


def regions(k, r):
    """For each vector of case counts, the fresh totals that reject."""
    out = {}
    for vector in compositions(k, 2 * r + 1):
        dist = [Fraction(1)]
        for t, n in enumerate(vector):
            for _ in range(n):
                dist = polymul(dist, null_case(r, t))
        reject = []
        for s in range(len(dist)):
            below = sum(dist[: s + 1])
            above = sum(dist[s:])
            reject.append(dist[s] > 0 and 2 * min(below, above) <= LEVEL)
        out[vector] = reject
    return out


def power_of(n, x):
    out = 1.0
    for _ in range(n):
        out *= x
    return out


def power(k, r, stored, fresh, region):
    bx = [comb(r, x) * power_of(x, stored) * power_of(r - x, 1 - stored) for x in range(r + 1)]
    by = [comb(r, y) * power_of(y, fresh) * power_of(r - y, 1 - fresh) for y in range(r + 1)]
    joint = [[bx[t - y] * by[y] if 0 <= t - y <= r else 0.0 for y in range(r + 1)]
             for t in range(2 * r + 1)]
    total = 0.0
    for vector, reject in region.items():
        ways = factorial(k)
        for n in vector:
            ways //= factorial(n)
        alt = [1.0]
        for t, n in enumerate(vector):
            for _ in range(n):
                alt = polymul(alt, joint[t])
        total += ways * sum(a for a, rej in zip(alt, reject) if rej)
    return min(1.0, total)


def direction(k, r, rate, sign, region):
    largest = 1 - rate if sign > 0 else rate
    grid = []
    m = 1
    while m / 20 < largest - 1e-12:
        at = power(k, r, rate, rate + sign * m / 20, region)
        grid.append({"drift": m / 20, "power": at})
        if at >= TARGET:
            return {"largest": largest, "caught": True, "drift": m / 20, "power": at, "grid": grid}
        m += 1
    at = power(k, r, rate, 1.0 if sign > 0 else 0.0, region)
    grid.append({"drift": largest, "power": at})
    if at >= TARGET:
        return {"largest": largest, "caught": True, "drift": largest, "power": at, "grid": grid}
    return {"largest": largest, "caught": False, "drift": None, "power": at, "grid": grid}


SETTINGS = [(15, 2, 0.8), (15, 2, 0.5), (15, 2, 0.3), (5, 2, 0.9), (10, 3, 0.6), (40, 1, 0.5),
            (15, 2, 1.0), (15, 2, 0.0)]


def main(path):
    rows = []
    cache = {}
    for k, r, rate in SETTINGS:
        if (k, r) not in cache:
            cache[(k, r)] = regions(k, r)
        region = cache[(k, r)]
        rows.append({"cases": k, "trials": r, "rate": rate,
                     "down": direction(k, r, rate, -1, region),
                     "up": direction(k, r, rate, 1, region)})
    with open(path, "w") as f:
        json.dump({"settings": rows}, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
