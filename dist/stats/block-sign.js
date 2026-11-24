/**
 * One-sided randomization p-value for the sum of block contrasts, with ties in the tail.
 * Flipping a subset changes the sum by minus twice that subset's sum. For a lower-tail
 * test, the flipped sum is at most the observed sum exactly when the subset sum is nonnegative.
 */
export function blockSignP(contrasts) {
    const sums = [0];
    for (const contrast of contrasts) {
        const count = sums.length;
        for (let index = 0; index < count; index++)
            sums.push(sums[index] + contrast);
    }
    return sums.filter((sum) => sum >= 0).length / sums.length;
}
//# sourceMappingURL=block-sign.js.map