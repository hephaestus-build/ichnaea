"""Writes test/reference-mpmath-normal.json: the standard normal distribution function and its
quantile at 60 significant digits (mpmath), rounded to the nearest double, on a dense grid with
extra points on both sides of every branch boundary of src/normal.ts. Test-only oracle. Run in a
container:
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w python:3.13-slim \
    sh -c "pip install -q mpmath==1.3.0 && python scripts/reference-normal-mpmath.py"
"""
import json
import math
import random

import mpmath
from mpmath import mp, mpf, ncdf, npdf

mp.dps = 60


def grid(lo, hi, step):
    n = round((hi - lo) / step)
    return [lo + (hi - lo) * i / n for i in range(n + 1)]


def near(points, width, step):
    return [x for c in points for x in grid(c - width, c + width, step)]


xs = grid(-38.46, 8.29, 0.02)
xs += near([0.67448975, -0.67448975, math.sqrt(32), -math.sqrt(32)], 0.25, 0.001)
xs += near([-38.4674, 8.2924], 0.01, 0.001)
# Seeded random points across both branch regions: a branch moved inside its region is only off
# at scattered points, which a regular grid can miss.
sample = random.Random(20261115)
for lo, hi in [(0.4, 0.95), (5.3, 6.0)]:
    xs += [s * sample.uniform(lo, hi) for s in (1, -1) for _ in range(2000)]
xs = sorted(set(x for x in xs if -38.4674 < x < 8.2924))

ps = [10 ** (-323.3 + (math.log10(0.5) + 323.3) * i / 1500) for i in range(1501)]
ps += [1 - 10 ** (-16 + (16 + math.log10(0.5)) * i / 300) for i in range(301)]
ps += grid(0.001, 0.999, 0.001)
ps += near([0.075, 0.925], 0.005, 0.0001)
ps += [math.exp(-25) * (0.9 + 0.2 * i / 100) for i in range(101)]
ps += [math.exp(-729) * (0.5 + 1.5 * i / 100) for i in range(101)]
ps += [10 ** sample.uniform(-323.3, math.log10(2.5e-317)) for _ in range(1000)]
ps = sorted(set(p for p in ps if 0 < p < 1))


def quantile(p):
    if p == 0.5:
        return mpf(0)
    target = mpf(p)
    x = mpf(-math.sqrt(-2 * math.log(p)) if p < 0.5 else math.sqrt(-2 * math.log1p(-p)))
    for _ in range(200):
        step = (ncdf(x) - target) / npdf(x)
        x -= step
        if abs(step) < mpf(10) ** -50 * max(1, abs(x)):
            break
    return x


constants = {
    "one_over_sqrt_2pi": float(1 / mp.sqrt(2 * mp.pi)),
    "sqrt_32": float(mp.sqrt(32)),
    "two_pi": float(2 * mp.pi),
}
with open("test/reference-mpmath-normal.json", "w") as out:
    json.dump(
        {
            "oracle": f"mpmath {mpmath.__version__}, {mp.dps} digits",
            "constants": constants,
            "pnorm": [[x, float(ncdf(x))] for x in xs],
            "qnorm": [[p, float(quantile(p))] for p in ps],
        },
        out,
    )
    out.write("\n")
