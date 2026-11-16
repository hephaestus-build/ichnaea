function logChoose(n, k) {
    return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}
const LOG_FACTORIALS = [0];
function logFactorial(n) {
    for (let i = LOG_FACTORIALS.length; i <= n; i++)
        LOG_FACTORIALS.push(LOG_FACTORIALS[i - 1] + Math.log(i));
    return LOG_FACTORIALS[n];
}
/**
 * Exact stratified conditional test of "no difference in any stratum" (a stratified
 * permutation test of arm labels within cases). Conditional on each stratum's total successes,
 * the candidate's successes are hypergeometric, and their sum has the convolution of those
 * distributions. Returns the one-sided p-value for a lower (`less`) or higher (`greater`)
 * candidate total. Valid at any size; conservative because the statistic is discrete.
 */
export function exactStratifiedTest(strata, alternative) {
    let distribution = [1];
    let observed = 0;
    for (const s of strata) {
        const n1 = s.candidate.trials;
        const n2 = s.base.trials;
        if (n1 === 0 || n2 === 0)
            continue;
        const total = s.candidate.successes + s.base.successes;
        observed += s.candidate.successes;
        const lo = Math.max(0, total - n2);
        const hi = Math.min(n1, total);
        const denominator = logChoose(n1 + n2, total);
        const pmf = [];
        for (let k = 0; k <= hi; k++)
            pmf.push(k < lo ? 0 : Math.exp(logChoose(n1, k) + logChoose(n2, total - k) - denominator));
        const next = Array.from({ length: distribution.length + pmf.length - 1 }, () => 0);
        distribution.forEach((a, i) => pmf.forEach((b, j) => (next[i + j] = next[i + j] + a * b)));
        distribution = next;
    }
    let p = 0;
    distribution.forEach((mass, t) => {
        if (alternative === "less" ? t <= observed : t >= observed)
            p += mass;
    });
    return { statistic: observed, p: Math.min(1, p), method: "exact-stratified-conditional" };
}
//# sourceMappingURL=exact-conditional.js.map