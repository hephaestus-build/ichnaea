/**
 * The weighted mean Σ wᵢxᵢ / Σ wᵢ of values in [0, 1], with positive weights. Dividing by the sum of
 * the same weights keeps it inside [0, 1] in floating point: each rounded fl(wᵢxᵢ) is at most wᵢ,
 * and a sum taken in the same order cannot grow when its terms shrink, so the numerator never
 * exceeds the denominator. A mean of ones is then exactly 1, where Σ wᵢxᵢ alone can round to
 * 1 + 2⁻⁵² (nine weights of 1/9, for example). The caller validates each value and weight.
 */
export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i++) {
    numerator += weights[i]! * values[i]!;
    denominator += weights[i]!;
  }
  return numerator / denominator;
}
