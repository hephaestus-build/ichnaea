"""Test-only oracle for the stratified score permutation test, written independently of the
TypeScript from a formula-only specification.

Specification
-------------
Input: a table of k cases. Each table has an integer denominator D >= 1.
Each case has two lists of integer units: `candidate` (length nC) and `base`
(length nB), with 0 <= u <= D. A case with nC = 0 or nB = 0 leaves the table.
A value is exactly u / D, so every value is in [0, 1]. The lengths vary by case.

Statistic: T = (1/k) * sum_i (mean(candidate_i) - mean(base_i)).

Null distribution: within each case independently, pool the nC + nB values
and assign any nC of them to the candidate and the rest to the base. All
C(nC + nB, nC) subsets of positions are equally likely. Cases are
independent. Duplicate values are distinct positions.

p-value (one-sided, toward a drop): p = P(T* <= T_obs) under that null.
Ties count as <=. All exact work uses fractions.Fraction, so ties are exact.

Algorithms
----------
- exact_bruteforce: enumerates the product over cases of all position
  subsets. Used when the total number of labellings is <= 2 * 10^5.
- exact_dp: builds each case's exact distribution of
  d_i = mean(C) - mean(B) as {Fraction: Fraction probability} from a
  (subset size, subset sum) count recursion, then convolves the cases.
  Used for larger tables. A table whose support grows past 2 * 10^6 points
  is skipped.
- monte_carlo_p: a cross-check only, never used by main.

Input and output
----------------
    python score_permutation_oracle.py tables.json results.json

tables.json:
    {"tables": [{"id": ..., "denominator": D,
                 "cases": [{"candidate": [u, ...], "base": [u, ...]}, ...]}]}
results.json:
    {"oracle": "python <ver> numpy <ver>",
     "results": [{"id": ..., "p": float | null, "pExact": "num/den" | null,
                  "method": "exact-bruteforce" | "exact-dp" | "skipped"}]}

Writes test/reference-python-score-permutation.json in CI. Run from packages/stats in the pinned
container (the image is the PYTHON_IMAGE of .github/workflows/ci.yml):
    docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w python:3.13-slim sh -c \\
      "pip install -q --require-hashes -r scripts/oracle-requirements.txt \\
      && python scripts/score_permutation_oracle_test.py \\
      && python scripts/score_permutation_oracle.py test/reference-score-permutation-tables.json \\
         test/reference-python-score-permutation.json"
"""

import itertools
import json
import math
import platform
import sys
from fractions import Fraction

import numpy as np

BRUTE_FORCE_LIMIT = 200_000
SUPPORT_LIMIT = 2_000_000


class SupportTooLarge(Exception):
    """The DP support exceeds SUPPORT_LIMIT points."""


# ---------------------------------------------------------------------------
# Input


def parse_table(table):
    """Return the table's cases as [(candidate, base)] lists of Fractions."""
    denominator = table["denominator"]
    if isinstance(denominator, bool) or not isinstance(denominator, int) or denominator < 1:
        raise ValueError(f"table {table.get('id')!r}: denominator must be a positive integer")
    cases = table["cases"]
    if len(cases) < 1:
        raise ValueError(f"table {table.get('id')!r}: needs at least one case")
    parsed = []
    for case in cases:
        lists = []
        for key in ("candidate", "base"):
            units = case[key]
            for u in units:
                if isinstance(u, bool) or not isinstance(u, int) or not 0 <= u <= denominator:
                    raise ValueError(
                        f"table {table.get('id')!r}: {key} unit {u!r} is not an integer in [0, {denominator}]"
                    )
            lists.append([Fraction(u, denominator) for u in units])
        # A case without a completed trial in an arm does not enter the test.
        if lists[0] and lists[1]:
            parsed.append((lists[0], lists[1]))
    if not parsed:
        raise ValueError(f"table {table.get('id')!r}: no case has a value in both arms")
    return parsed


def mean(values):
    return sum(values, Fraction(0)) / len(values)


def observed_statistic(cases):
    """T_obs = (1/k) * sum_i (mean(C_i) - mean(B_i)), exact."""
    return sum((mean(c) - mean(b) for c, b in cases), Fraction(0)) / len(cases)


def labelling_count(cases):
    return math.prod(math.comb(len(c) + len(b), len(c)) for c, b in cases)


# ---------------------------------------------------------------------------
# (a) Brute force


def exact_bruteforce(cases):
    """Enumerate every joint labelling. Returns p as a Fraction."""
    k = len(cases)
    t_obs = observed_statistic(cases)
    per_case = []
    for c, b in cases:
        pooled = c + b
        n, n_c = len(pooled), len(c)
        options = []
        for chosen in itertools.combinations(range(n), n_c):
            chosen_set = set(chosen)
            cand = [pooled[i] for i in chosen]
            base = [pooled[i] for i in range(n) if i not in chosen_set]
            options.append(mean(cand) - mean(base))
        per_case.append(options)
    total = 0
    hits = 0
    for combo in itertools.product(*per_case):
        total += 1
        t_star = sum(combo, Fraction(0)) / k
        if t_star <= t_obs:
            hits += 1
    return Fraction(hits, total)


# ---------------------------------------------------------------------------
# (b) Dynamic programming convolution


def case_distribution(candidate, base):
    """Exact distribution of d = mean(C*) - mean(B*) for one case.

    Counts subsets of the pooled positions by (size, sum), then maps each
    size-nC subset sum s to d = s/nC - (S - s)/nB.
    """
    pooled = candidate + base
    n_c, n_b = len(candidate), len(base)
    total_sum = sum(pooled, Fraction(0))
    # counts[j] maps a subset sum to the number of size-j subsets with that sum.
    counts = [dict() for _ in range(n_c + 1)]
    counts[0][Fraction(0)] = 1
    for value in pooled:
        for j in range(n_c, 0, -1):
            source = counts[j - 1]
            target = counts[j]
            for s, ways in source.items():
                key = s + value
                target[key] = target.get(key, 0) + ways
            if len(target) > SUPPORT_LIMIT:
                raise SupportTooLarge()
    subsets = math.comb(n_c + n_b, n_c)
    distribution = {}
    for s, ways in counts[n_c].items():
        d = s / n_c - (total_sum - s) / n_b
        distribution[d] = distribution.get(d, Fraction(0)) + Fraction(ways, subsets)
    return distribution


def convolve(left, right):
    out = {}
    for a, pa in left.items():
        for b, pb in right.items():
            key = a + b
            out[key] = out.get(key, Fraction(0)) + pa * pb
        if len(out) > SUPPORT_LIMIT:
            raise SupportTooLarge()
    return out


def exact_dp(cases):
    """Convolve per-case distributions of d_i. Returns p as a Fraction.

    T* <= T_obs is compared as sum_i d_i* <= sum_i d_i (both sides times k).
    Raises SupportTooLarge if the support passes SUPPORT_LIMIT points.
    """
    observed_sum = observed_statistic(cases) * len(cases)
    total = {Fraction(0): Fraction(1)}
    for c, b in cases:
        total = convolve(total, case_distribution(c, b))
    return sum((p for d, p in total.items() if d <= observed_sum), Fraction(0))


# ---------------------------------------------------------------------------
# Dispatcher


def exact_p(table):
    """Exact p for one table.

    Returns (p_fraction | None, p_float | None, method).
    """
    cases = parse_table(table)
    if labelling_count(cases) <= BRUTE_FORCE_LIMIT:
        p = exact_bruteforce(cases)
        return p, float(p), "exact-bruteforce"
    try:
        p = exact_dp(cases)
    except SupportTooLarge:
        print(
            f"note: table {table.get('id')!r} skipped: DP support exceeds {SUPPORT_LIMIT} points",
            file=sys.stderr,
        )
        return None, None, "skipped"
    return p, float(p), "exact-dp"


# ---------------------------------------------------------------------------
# Monte Carlo (cross-check only)


def monte_carlo_p(table, seed, resamples):
    """Monte Carlo p with PCG64(seed). Returns (p, standard_error).

    p = (1 + #{T* <= T_obs + 1e-12}) / (1 + resamples).
    The standard error is sqrt(p * (1 - p) / resamples).
    """
    rng = np.random.Generator(np.random.PCG64(seed))
    denominator = table["denominator"]
    k = len(table["cases"])
    t_obs = 0.0
    t_star = np.zeros(resamples)
    for case in table["cases"]:
        cand = np.asarray(case["candidate"], dtype=np.float64) / denominator
        base = np.asarray(case["base"], dtype=np.float64) / denominator
        n_c = cand.size
        t_obs += cand.mean() - base.mean()
        pooled = np.concatenate([cand, base])
        shuffled = rng.permuted(np.tile(pooled, (resamples, 1)), axis=1)
        t_star += shuffled[:, :n_c].mean(axis=1) - shuffled[:, n_c:].mean(axis=1)
    t_obs /= k
    t_star /= k
    hits = int(np.count_nonzero(t_star <= t_obs + 1e-12))
    p = (1 + hits) / (1 + resamples)
    se = math.sqrt(p * (1 - p) / resamples)
    return p, se


# ---------------------------------------------------------------------------
# Main


def oracle_version():
    return f"python {platform.python_version()} numpy {np.__version__}"


def run(tables_document):
    results = []
    for table in tables_document["tables"]:
        p, p_float, method = exact_p(table)
        results.append(
            {
                "id": table["id"],
                "p": p_float,
                "pExact": None if p is None else f"{p.numerator}/{p.denominator}",
                "method": method,
            }
        )
    return {"oracle": oracle_version(), "results": results}


def main(argv):
    if len(argv) != 3:
        print("usage: python score_permutation_oracle.py tables.json results.json", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as handle:
        document = json.load(handle)
    output = run(document)
    with open(argv[2], "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=None)
        handle.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
