import type { AssignedPair } from "./blocks.ts";
export interface BlockComparison {
    readonly blockP: number;
    readonly withinP: number;
    readonly blockLower: number;
    readonly withinLower: number;
    readonly withinPairs: number;
    readonly missing: number;
    readonly pass: boolean;
    readonly passReason?: string;
}
/** Limit exhaustive sign enumeration to the studied horizon. */
export declare const MAX_TEST_BLOCKS = 12;
/** Evaluate the locked pairs after filling each missing trial against its claim. */
export declare function compareBlocks(pairs: readonly AssignedPair[], mask: ReadonlySet<string>, scores: ReadonlyMap<string, number>, options: {
    readonly alpha: number;
    readonly blockEligible: boolean;
    readonly replicates: number;
    readonly margin?: number;
}): BlockComparison;
//# sourceMappingURL=block-comparison.d.ts.map