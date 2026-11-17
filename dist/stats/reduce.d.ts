/**
 * A reduction of a case's binary trials to one value: pass^k (`all`), pass@k (`any`) or
 * the majority with a declared tie rule. A reduced measure is estimate-only.
 */
export type Reduction = {
    readonly all: {
        readonly k: number;
    };
} | {
    readonly any: {
        readonly k: number;
    };
} | {
    readonly majority: {
        readonly tie: "pass" | "fail";
    };
};
/**
 * Reduces the r trials of one case. With c passes: `all` gives C(c, k)/C(r, k), the unbiased
 * estimate of pass^k; `any` gives 1 − C(r − c, k)/C(r, k), the unbiased estimate of pass@k; and
 * `majority` gives 1 above r/2, 0 below, and the tie rule at exactly r/2. r < k is refused.
 */
export declare function reduceTrials(values: readonly number[], reduction: Reduction): number;
//# sourceMappingURL=reduce.d.ts.map