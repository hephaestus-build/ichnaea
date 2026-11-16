/**
 * Holm's step-down adjusted p-values. Controls the family-wise error rate over the tests that can
 * each block a release.
 */
export declare function holm(pValues: readonly number[]): number[];
/**
 * Benjamini–Yekutieli adjusted q-values: false discovery rate control under any dependence.
 * Used for explored slices, which never get a verdict.
 */
export declare function benjaminiYekutieli(pValues: readonly number[]): number[];
//# sourceMappingURL=multiplicity.d.ts.map