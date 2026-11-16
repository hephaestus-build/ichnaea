"""Self-test for score_permutation_oracle.py.

1. Hand-checkable cases.
2. Brute force equals DP (exact Fraction equality) on random small tables.
3. Monte Carlo with 200,000 resamples is within 4 SE of the exact p.
4. The DP and skip paths and the JSON round trip of main.

Run from packages/stats: python scripts/score_permutation_oracle_test.py (in the container that the
oracle's docstring names). Test-only.
"""

import json
import math
import os
import random
import sys
import tempfile
from fractions import Fraction

import score_permutation_oracle as oracle

FAILURES = []


def check(condition, message):
    status = "ok  " if condition else "FAIL"
    print(f"[{status}] {message}")
    if not condition:
        FAILURES.append(message)


def table(table_id, denominator, cases):
    return {
        "id": table_id,
        "denominator": denominator,
        "cases": [{"candidate": c, "base": b} for c, b in cases],
    }


def both_exact(t):
    cases = oracle.parse_table(t)
    return oracle.exact_bruteforce(cases), oracle.exact_dp(cases)


# ---------------------------------------------------------------------------
# 1. Hand-checkable cases

SINGLE = table("single", 1, [([1, 0], [0, 1])])
THREE = table("three-case", 4, [([4, 3], [2, 3]), ([4, 4], [1, 2]), ([2, 3], [3, 4])])
MIXED = table("mixed-counts", 5, [([1], [2, 3, 5])])
EQUAL_ONLY = table("equal-only", 10, [([7, 7, 7], [7, 7])])


def hand_checks():
    print("== hand-checkable cases")

    cases = oracle.parse_table(SINGLE)
    check(oracle.observed_statistic(cases) == 0, "single: T_obs = 0")
    dist = oracle.case_distribution(*cases[0])
    check(
        dist == {Fraction(-1): Fraction(1, 6), Fraction(0): Fraction(4, 6), Fraction(1): Fraction(1, 6)},
        f"single: T* distribution {{-1: 1/6, 0: 4/6, 1: 1/6}} (got {dist})",
    )
    brute, dp = both_exact(SINGLE)
    check(brute == dp == Fraction(5, 6), f"single: p = 5/6 (brute {brute}, dp {dp})")

    cases = oracle.parse_table(THREE)
    t_obs = oracle.observed_statistic(cases)
    brute, dp = both_exact(THREE)
    check(brute == dp, f"three-case: brute {brute} == dp {dp}")
    print(f"       three-case: T_obs = {t_obs}, p = {brute} = {float(brute):.12g}")

    # C = [0.2], B = [0.4, 0.6, 1]: d_obs = 0.2 - 2/3 = -7/15 is the unique minimum of 4.
    cases = oracle.parse_table(MIXED)
    check(oracle.observed_statistic(cases) == Fraction(-7, 15), "mixed: T_obs = -7/15")
    brute, dp = both_exact(MIXED)
    check(brute == dp == Fraction(1, 4), f"mixed: p = 1/4 (brute {brute}, dp {dp})")

    # A case whose values are all equal has d = 0 under every labelling.
    cases = oracle.parse_table(EQUAL_ONLY)
    check(oracle.case_distribution(*cases[0]) == {Fraction(0): Fraction(1)}, "equal: d is the constant 0")
    brute, dp = both_exact(EQUAL_ONLY)
    check(brute == dp == 1, f"equal only: p = 1 (brute {brute}, dp {dp})")
    with_equal = table("three-plus-equal", 20, [([8, 6], [4, 6]), ([8, 8], [2, 4]), ([4, 6], [6, 8]), ([7, 7, 7], [7, 7])])
    p_three = both_exact(THREE)[0]
    brute, dp = both_exact(with_equal)
    check(
        brute == dp == p_three,
        f"equal: adding an all-equal case leaves p unchanged ({p_three} -> brute {brute}, dp {dp})",
    )


# ---------------------------------------------------------------------------
# 2. Brute force equals DP on random small tables


def random_table(rng, table_id, max_labellings):
    while True:
        denominator = rng.choice([1, 2, 4, 5, 10, 100, 10**6])
        k = rng.randint(1, 4)
        cases = []
        for _ in range(k):
            n_c, n_b = rng.randint(1, 4), rng.randint(1, 4)
            if rng.random() < 0.5:
                # A coarse grid gives many exact ties.
                grid = [0, denominator // 2, denominator] if denominator > 1 else [0, 1]
                pick = lambda: rng.choice(grid)  # noqa: E731
            else:
                pick = lambda: rng.randint(0, denominator)  # noqa: E731
            cases.append(([pick() for _ in range(n_c)], [pick() for _ in range(n_b)]))
        t = table(table_id, denominator, cases)
        if oracle.labelling_count(oracle.parse_table(t)) <= max_labellings:
            return t


def brute_vs_dp():
    print("== brute force vs DP on random small tables")
    rng = random.Random(20261116)
    count, mismatches = 200, 0
    for i in range(count):
        t = random_table(rng, f"rand-{i}", 5_000)
        brute, dp = both_exact(t)
        if brute != dp:
            mismatches += 1
            print(f"       mismatch {t}: brute {brute}, dp {dp}")
    check(mismatches == 0, f"brute == dp on {count} random tables (mismatches: {mismatches})")


# ---------------------------------------------------------------------------
# 3. Monte Carlo within 4 SE of exact


def monte_carlo_checks():
    print("== Monte Carlo (200,000 resamples) vs exact")
    resamples = 200_000
    rng = random.Random(7)
    tables = [SINGLE, THREE, MIXED]
    tables += [random_table(rng, f"mc-{i}", 20_000) for i in range(10)]
    for seed, t in enumerate(tables, start=1):
        exact = oracle.exact_dp(oracle.parse_table(t))
        p_mc, se_mc = oracle.monte_carlo_p(t, seed, resamples)
        # The SE of the estimator under the exact p; the +1 in the estimator adds at most 1/(R+1).
        se_true = math.sqrt(float(exact) * (1 - float(exact)) / resamples)
        tolerance = 4 * se_true + 1 / (resamples + 1)
        diff = abs(p_mc - float(exact))
        check(
            diff <= tolerance,
            f"{t['id']}: exact {float(exact):.6f}, MC {p_mc:.6f} (SE {se_mc:.2e}), |diff| {diff:.2e} <= {tolerance:.2e}",
        )


# ---------------------------------------------------------------------------
# 4. DP path, skip path and main round trip


def main_round_trip():
    print("== main: DP path, skip path, JSON round trip")
    # 5 cases of 3 + 3 values: 20^5 = 3.2e6 labellings, so main must use the DP.
    dp_table = table(
        "dp-path",
        4,
        [([4, 3, 1], [2, 3, 0]), ([4, 4, 2], [1, 2, 3]), ([2, 3, 0], [3, 4, 4]), ([1, 1, 1], [0, 4, 2]), ([0, 2, 4], [4, 3, 3])],
    )
    # Three cases of 8 + 8 distinct values over D = 10^6: the joint support passes 2e6 points.
    srng = random.Random(99)
    skip_table = table(
        "skip-path",
        10**6,
        [([srng.randint(0, 10**6) for _ in range(8)], [srng.randint(0, 10**6) for _ in range(8)]) for _ in range(3)],
    )
    document = {"tables": [SINGLE, THREE, MIXED, dp_table, skip_table]}
    with tempfile.TemporaryDirectory() as tmp:
        source, target = os.path.join(tmp, "in.json"), os.path.join(tmp, "out.json")
        with open(source, "w", encoding="utf-8") as handle:
            json.dump(document, handle)
        check(oracle.main(["oracle", source, target]) == 0, "main exits 0")
        with open(target, encoding="utf-8") as handle:
            text = handle.read()
    check(text.endswith("}\n") and text.count("\n") == 1, "output is one JSON line with a trailing newline")
    output = json.loads(text)
    print(f"       oracle: {output['oracle']}")
    by_id = {r["id"]: r for r in output["results"]}
    check(by_id["single"] == {"id": "single", "p": 5 / 6, "pExact": "5/6", "method": "exact-bruteforce"}, "single result row")
    check(by_id["mixed-counts"]["pExact"] == "1/4", "mixed result row")
    check(by_id["dp-path"]["method"] == "exact-dp", f"dp-path uses DP (p = {by_id['dp-path']['pExact']})")
    p_mc, se = oracle.monte_carlo_p(dp_table, 123, 200_000)
    p_dp = by_id["dp-path"]["p"]
    check(abs(p_mc - p_dp) <= 4 * math.sqrt(p_dp * (1 - p_dp) / 200_000) + 1 / 200_001, f"dp-path: MC {p_mc:.6f} agrees with DP {p_dp:.6f}")
    check(
        by_id["skip-path"] == {"id": "skip-path", "p": None, "pExact": None, "method": "skipped"},
        "skip-path is skipped",
    )


if __name__ == "__main__":
    hand_checks()
    brute_vs_dp()
    monte_carlo_checks()
    main_round_trip()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed")
        sys.exit(1)
    print("all checks passed")
