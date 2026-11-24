import { blockSignP } from "./block-sign.ts";
import { scoreDifferenceInterval, type Stratum } from "./score-difference.ts";

/** Sum of pair differences and number of planned pairs that it represents. */
export interface BlockContrast {
  readonly numerator: number;
  readonly pairs: number;
}

/** Lower-tail randomization p-value. Integer numerators retain all exact ties. */
export function sharpNullBlockP(blocks: readonly BlockContrast[]): number {
  return blockSignP(blocks.map((block) => block.numerator));
}

/**
 * Invert the upper-tail sign-flip test at a common additive shift. The empty subset
 * always counts. Each other subset enters the tail when the hypothesized shift reaches
 * that subset's mean. Keep ties by using the first boundary at which rejection stops.
 */
export function blockLowerBound(blocks: readonly BlockContrast[], alpha: number): number {
  const count = Math.floor(alpha * 2 ** blocks.length);
  if (count < 1) return -1;
  const subsets: BlockContrast[] = [{ numerator: 0, pairs: 0 }];
  for (const block of blocks) {
    const size = subsets.length;
    for (let i = 0; i < size; i++) {
      const previous = subsets[i]!;
      subsets.push({
        numerator: previous.numerator + block.numerator,
        pairs: previous.pairs + block.pairs,
      });
    }
  }
  const means = subsets
    .slice(1)
    .map(({ numerator, pairs }) => numerator / pairs)
    .toSorted((a, b) => a - b);
  return means[count - 1] ?? -1;
}

/** The lower tail of Binomial(negative + positive, 1/2), retaining ties. */
export function sharpNullPairP(negative: number, positive: number): number {
  const n = negative + positive;
  if (n === 0) return 1;
  // Scale the probability masses by the modal mass, so the recurrence needs no factorials and
  // starts from 1 even when 2^-n underflows. Reflection handles the upper half of the CDF.
  const centre = Math.floor(n / 2);
  const reflected = positive > centre;
  const target = reflected ? negative - 1 : positive;
  let total = n % 2 === 0 ? 1 : 2;
  let tail = target === centre ? 1 : 0;
  let mass = 1;
  for (let k = centre; k > 0; k--) {
    mass *= k / (n - k + 1);
    total += 2 * mass;
    if (k - 1 <= target) tail += mass;
  }
  const lower = tail / total;
  return reflected ? 1 - lower : lower;
}

/** The within-run score bound, over the fixed case × block strata. */
export function withinRunLowerBound(strata: readonly Stratum[], alpha: number): number {
  return scoreDifferenceInterval(strata, 1 - alpha, "lower").lower;
}

/** PASS requires strict clearance of the same margin by each bound. */
export function bothBoundsClear(block: number, within: number, margin: number): boolean {
  return block > -margin && within > -margin;
}
