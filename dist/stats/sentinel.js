import { exactStratifiedTest } from "./exact-conditional.js";
import { createRng } from "./rng.js";
import { assertLevel } from "./types.js";
/**
 * Whether a two-sided p-value rejects at `level`. The tolerance keeps the sentinel test and the
 * power of the drift guard on the same side of a p-value that equals the level up to rounding.
 */
function rejects(p, level) {
    return p <= level * (1 + 1e-9);
}
/**
 * The drift guard of a `fast` run: the exact stratified conditional test of the fresh base trials
 * (`candidate`) against the stored base trials (`base`) of the sentinel cases, two-sided as twice
 * the smaller one-sided p-value, because a drift in either direction invalidates the baseline.
 */
export function sentinelTest(strata, level = 0.05) {
    assertLevel(level);
    const less = exactStratifiedTest(strata, "less").p;
    const greater = exactStratifiedTest(strata, "greater").p;
    const p = Math.min(1, 2 * Math.min(less, greater));
    return { p, drifted: rejects(p, level), method: "exact-stratified-conditional-two-sided" };
}
/**
 * The most trials per case that the power takes. `choose` multiplies before it divides, and from
 * C(1022, 511) on its products overflow: a case's null distribution then comes out all 0, and the
 * power is 0 where it is 1. A sentinel takes a few trials per case, so more than 500 is refused
 * rather than computed in logarithms, which would trade the +, × and ÷ of the exact sum for exp and
 * log.
 */
const MAX_TRIALS = 500;
function assertTrials(trials) {
    if (!(Number.isInteger(trials) && trials >= 1 && trials <= MAX_TRIALS))
        throw new RangeError(`the sentinel takes 1 to ${MAX_TRIALS} trials per case, got ${trials}`);
}
/** C(n, k), exact for the small n of one case's trials. */
function choose(n, k) {
    if (k < 0 || k > n)
        return 0;
    let c = 1;
    for (let i = 1; i <= k; i++)
        c = (c * (n - k + i)) / i;
    return Math.round(c);
}
function convolve(a, b) {
    const out = Array.from({ length: a.length + b.length - 1 }, () => 0);
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === 0)
            continue;
        for (let j = 0; j < b.length; j++)
            out[i + j] += x * b[j];
    }
    return out;
}
/** The fresh successes y of a case whose stored and fresh trials total t, under the null. */
function nullCase(trials, total) {
    const all = choose(2 * trials, total);
    return Array.from({ length: trials + 1 }, (_, y) => total - y < 0 || total - y > trials ? 0 : (choose(trials, y) * choose(trials, total - y)) / all);
}
/** Which fresh totals s reject, given the null distribution of s. */
function rejection(nullDistribution, level) {
    const below = [];
    let sum = 0;
    for (const mass of nullDistribution)
        below.push((sum += mass));
    const above = Array.from({ length: nullDistribution.length }, () => 0);
    sum = 0;
    for (let s = nullDistribution.length - 1; s >= 0; s--)
        above[s] = sum += nullDistribution[s];
    return nullDistribution.map((mass, s) => mass > 0 && rejects(Math.min(1, 2 * Math.min(below[s], above[s])), level));
}
const binomial = (trials, rate) => Array.from({ length: trials + 1 }, (_, x) => choose(trials, x) * rate ** x * (1 - rate) ** (trials - x));
/**
 * The exact power of the sentinel test with `cases` cases of `trials` stored and `trials` fresh
 * trials, every stored trial at `stored` and every fresh trial at `fresh`. It sums over the counts
 * of cases at each case total t, which the test conditions on: C(cases + 2·trials, 2·trials) terms.
 */
export function sentinelPowerExact(cases, trials, stored, fresh, level = 0.05) {
    assertTrials(trials);
    const top = 2 * trials;
    const xs = binomial(trials, stored);
    const ys = binomial(trials, fresh);
    // P(T = t, Y = y) for one case.
    const joint = Array.from({ length: top + 1 }, (_, t) => Array.from({ length: trials + 1 }, (__, y) => t - y < 0 || t - y > trials ? 0 : xs[t - y] * ys[y]));
    const joints = joint.map((one) => convolutionPowers(one, cases));
    const regions = rejectionRegions(cases, trials, level);
    let leaf = 0;
    let power = 0;
    // The leaves in the order rejectionRegions recorded them: the counts of cases at t = 0 … 2r.
    const visit = (t, left, alt) => {
        if (t === top) {
            const a = convolve(alt, joints[t][left]);
            const { ways, reject } = regions[leaf++];
            for (const s of reject)
                power += ways * a[s];
            return;
        }
        for (let count = 0; count <= left; count++)
            visit(t + 1, left - count, convolve(alt, joints[t][count]));
    };
    visit(0, cases, [1]);
    return Math.min(1, power);
}
/** The n-fold convolutions of a distribution, n = 0 … cases. */
function convolutionPowers(one, cases) {
    const out = [[1]];
    for (let n = 1; n <= cases; n++)
        out.push(convolve(out[n - 1], one));
    return out;
}
/**
 * The rejection region of every vector of case counts, in a fixed order. It depends only on the
 * cases, the trials and the level, not on the rates, so a search over drifts computes it once.
 */
const REGIONS = new Map();
function rejectionRegions(cases, trials, level) {
    const key = `${cases}:${trials}:${level}`;
    const known = REGIONS.get(key);
    if (known !== undefined)
        return known;
    const top = 2 * trials;
    const nulls = Array.from({ length: top + 1 }, (_, t) => convolutionPowers(nullCase(trials, t), cases));
    const logFactorial = [0];
    for (let i = 1; i <= cases; i++)
        logFactorial.push(logFactorial[i - 1] + Math.log(i));
    const leaves = [];
    const visit = (t, left, logWays, nul) => {
        if (t === top) {
            const n = convolve(nul, nulls[t][left]);
            const reject = [];
            rejection(n, level).forEach((r, s) => {
                if (r)
                    reject.push(s);
            });
            leaves.push({ ways: Math.exp(logWays - logFactorial[left]), reject });
            return;
        }
        for (let count = 0; count <= left; count++)
            visit(t + 1, left - count, logWays - logFactorial[count], convolve(nul, nulls[t][count]));
    };
    visit(0, cases, logFactorial[cases], [1]);
    REGIONS.set(key, leaves);
    return leaves;
}
/**
 * The simulated power of the same test: `draws` runs from `seed`, each case drawing its stored
 * trials and then its fresh trials. Every call with the same seed uses the same uniforms, so the
 * powers at different fresh rates share their random numbers.
 */
export function sentinelPowerSimulated(cases, trials, stored, fresh, draws, seed, level = 0.05) {
    assertTrials(trials);
    const rng = createRng(seed);
    const top = 2 * trials;
    const nulls = Array.from({ length: top + 1 }, (_, t) => nullCase(trials, t));
    const regions = new Map();
    let hits = 0;
    const counts = Array.from({ length: top + 1 }, () => 0);
    for (let d = 0; d < draws; d++) {
        counts.fill(0);
        let s = 0;
        for (let c = 0; c < cases; c++) {
            let x = 0;
            let y = 0;
            for (let j = 0; j < trials; j++)
                if (rng.uniform() < stored)
                    x++;
            for (let j = 0; j < trials; j++)
                if (rng.uniform() < fresh)
                    y++;
            counts[x + y]++;
            s += y;
        }
        const key = counts.join(",");
        let region = regions.get(key);
        if (region === undefined) {
            let n = [1];
            counts.forEach((count, t) => {
                for (let i = 0; i < count; i++)
                    n = convolve(n, nulls[t]);
            });
            region = rejection(n, level);
            regions.set(key, region);
        }
        if (region[s])
            hits++;
    }
    return hits / draws;
}
/** The largest number of terms that the exact power sums before the guard simulates. */
const EXACT_TERMS = 1e5;
const DRAWS = 10_000;
/** The drift is rounded up to the next 1/STEPS = 0.05. */
const STEPS = 20;
/** `exact` while the exact power sums C(cases + 2·trials, 2·trials) ≤ 10⁵ terms, else `simulated`. */
export function sentinelMethod(cases, trials) {
    let terms = 1;
    for (let i = 1; i <= 2 * trials && terms <= EXACT_TERMS; i++)
        terms = (terms * (cases + i)) / i;
    return terms <= EXACT_TERMS * (1 + 1e-12) ? "exact" : "simulated";
}
/**
 * The drift of every case together that the sentinel test catches 4 times in 5, in each
 * direction, with every case at the stored rate p of the sentinel cases. In simulation, different
 * rates per case gave equal or higher power, so this is the pessimistic reference, but it is not a
 * bound. The
 * drift is rounded up to the next 0.05. It is computed at plan time from the stored base, never
 * from the fresh trials. The power is exact while C(cases + 2·trials, 2·trials) ≤ 10⁵, and
 * otherwise simulated with 10,000 draws from `seed`, the same draws at every drift. It refuses more
 * than 500 trials per case.
 */
export function sentinelDetectableDrift(input) {
    const { cases, trials, rate, seed } = input;
    const level = input.level ?? 0.05;
    const target = input.target ?? 0.8;
    assertLevel(level);
    if (!(Number.isInteger(cases) && cases >= 1))
        throw new RangeError(`the sentinel needs a positive whole number of cases, got ${cases}`);
    if (!(Number.isInteger(trials) && trials >= 1))
        throw new RangeError(`the sentinel needs a positive whole number of trials, got ${trials}`);
    if (!(rate >= 0 && rate <= 1))
        throw new RangeError(`the stored rate must be in [0, 1]`);
    if (!(target > 0 && target < 1))
        throw new RangeError(`the target power must be in (0, 1)`);
    const exact = sentinelMethod(cases, trials) === "exact";
    if (!exact && seed === undefined)
        throw new RangeError(`a sentinel of ${cases} cases × ${trials} trials is simulated: give a seed`);
    const power = (fresh) => exact
        ? sentinelPowerExact(cases, trials, rate, fresh, level)
        : sentinelPowerSimulated(cases, trials, rate, fresh, DRAWS, seed, level);
    const direction = (sign) => {
        const largest = sign > 0 ? 1 - rate : rate;
        for (let m = 1; m / STEPS < largest - 1e-12; m++) {
            const at = power(rate + (sign * m) / STEPS);
            if (at >= target)
                return { largest, caught: true, drift: m / STEPS, power: at };
        }
        const at = power(sign > 0 ? 1 : 0);
        return at >= target
            ? { largest, caught: true, drift: largest, power: at }
            : { largest, caught: false, drift: null, power: at };
    };
    return {
        rate,
        cases,
        trials,
        level,
        target,
        down: direction(-1),
        up: direction(1),
        method: exact ? "exact" : "simulated",
        ...(exact ? {} : { draws: DRAWS, seed }),
    };
}
//# sourceMappingURL=sentinel.js.map