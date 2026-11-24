interface BinaryCell {
    readonly trials: number;
    readonly successes: number;
}
type ArmCells = ReadonlyMap<string, ReadonlyMap<string, BinaryCell>>;
type Blocks = ReadonlyMap<number, ArmCells>;
/** Descriptive noise of a fixed set of cases. The two variance components have different units. */
export interface NoiseSummary {
    readonly arms: {
        readonly arm: string;
        readonly withinCaseVariance: number | null;
        readonly replicatedCells: number;
        readonly caseDispersion: number | null;
    }[];
    readonly betweenBlockVariance: number | null;
    readonly contrastBlocks: number;
}
/** Counts used for each component. A missing block contrast cannot enter the variance. */
export declare function noiseSummary(arms: readonly string[], byCase: ArmCells, byBlock: Blocks, plannedCases: readonly string[], pair: {
    readonly base: string;
    readonly candidate: string;
} | undefined): NoiseSummary;
export {};
//# sourceMappingURL=noise.d.ts.map