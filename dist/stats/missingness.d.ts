/** One arm's missing trials of one case, of the trials the plan asked for. */
export interface ArmMissing {
    /** The planned trials with no value. */
    readonly missing: number;
    /** The trials the plan asked for. */
    readonly planned: number;
}
/**
 * The exact test of a difference in missingness between the arms: the stratified
 * conditional test over cases, with the missing trials as the counted outcome, two-sided as twice
 * the smaller one-sided p-value, capped at 1. It flags; it never decides a comparison.
 */
export declare function missingDifferenceTest(cases: readonly {
    readonly base: ArmMissing;
    readonly candidate: ArmMissing;
}[]): {
    readonly p: number;
    readonly method: "exact-stratified-conditional-two-sided";
    readonly missing: {
        readonly base: number;
        readonly candidate: number;
    };
};
//# sourceMappingURL=missingness.d.ts.map