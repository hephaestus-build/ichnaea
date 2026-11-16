import { type Interval, type Sided, type TestResult } from "./types.ts";
/**
 * A paired 2x2 table of case-level binary outcomes. `candidateOnly` counts cases that pass under
 * the candidate and fail under the base; `baseOnly` the reverse.
 */
export interface PairedTable {
    readonly both: number;
    readonly candidateOnly: number;
    readonly baseOnly: number;
    readonly neither: number;
}
/** Score interval for the paired difference of proportions, candidate minus base (`sampled-cases`). */
export declare function tangoInterval(table: PairedTable, level?: number, sided?: Sided, skew?: boolean): Interval;
/** One-sided Tango score test at a hypothesised difference. */
export declare function tangoTest(table: PairedTable, delta0: number, alternative: "greater" | "less", skew?: boolean): TestResult;
//# sourceMappingURL=tango.d.ts.map