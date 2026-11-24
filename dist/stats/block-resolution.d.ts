/** The simulation searches a one-point grid for 80% power. */
export declare const TARGET_BLOCK_POWER = 0.8;
export declare const BLOCK_POWER_REPETITIONS = 1024;
/** A planned block test and the fixed-case model for its matched trials. */
export interface BlockPowerInput {
    readonly baseRates: readonly number[];
    readonly blocks: number;
    readonly replicates: number;
    readonly level: number;
}
/** A deterministic power estimate under independent Bernoulli trials and no block shocks. */
export declare function blockPower(input: BlockPowerInput, drop: number): number;
export type BlockResolution = {
    readonly kind: "detectable-drop";
    readonly drop: number;
} | {
    readonly kind: "extreme";
    readonly power: number;
};
/** Finds the detectable drop or gives the rejection rate when every candidate trial fails. */
export declare function blockResolution(input: BlockPowerInput): BlockResolution;
/** The default planning model spans base rates from 60% to 100%. */
export declare function defaultBaseRates(cases: number): number[];
//# sourceMappingURL=block-resolution.d.ts.map