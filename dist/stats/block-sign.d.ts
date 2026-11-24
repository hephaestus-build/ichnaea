/**
 * One-sided randomization p-value for the sum of block contrasts, with ties in the tail.
 * Flipping a subset changes the sum by minus twice that subset's sum. For a lower-tail
 * test, the flipped sum is at most the observed sum exactly when the subset sum is nonnegative.
 */
export declare function blockSignP(contrasts: readonly number[]): number;
//# sourceMappingURL=block-sign.d.ts.map