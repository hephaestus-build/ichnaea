/**
 * Agreement between raters: raw agreement, Cohen's kappa, Gwet's AC1 and Krippendorff's alpha.
 * Point estimates only. Intervals come from resampling whole cases, which the caller does, because
 * items that share a case are not independent and the analytic variances assume they are.
 */

/**
 * A square table of counts: `table[i][j]` is the number of items that the first rater put in
 * category `i` and the second rater in category `j`. Its size is the number of declared
 * categories, including categories that nobody chose: Gwet's AC1 depends on that number.
 */
export type AgreementTable = readonly (readonly number[])[];

/** A confusion table built from two raters' labels on the same items. */
export interface ConfusionTable {
  /** The declared categories, in the order of the table's rows and columns. */
  readonly categories: readonly string[];
  /** The counts, `table[i][j]` as in {@link AgreementTable}. */
  readonly table: number[][];
  /** The number of items that both raters labelled. */
  readonly pairs: number;
  /** The number of items left out because at least one rater gave no label. */
  readonly skipped: number;
}

/**
 * Builds the confusion table of two raters. A null label is missing: the item is left out and
 * counted in `skipped`, never put in a category. A label outside `categories` throws, so a typo
 * cannot become a silent disagreement.
 */
export function confusionTable(
  first: readonly (string | null)[],
  second: readonly (string | null)[],
  categories: readonly string[],
): ConfusionTable {
  if (first.length !== second.length) {
    throw new RangeError(
      `the raters label different numbers of items: ${first.length} and ${second.length}`,
    );
  }
  if (categories.length < 2) throw new RangeError("agreement needs at least two categories");
  const index = new Map(categories.map((category, i) => [category, i]));
  if (index.size !== categories.length) throw new RangeError("the categories contain a duplicate");
  const table = categories.map(() => categories.map(() => 0));
  let pairs = 0;
  let skipped = 0;
  for (let item = 0; item < first.length; item++) {
    const a = first[item] ?? null;
    const b = second[item] ?? null;
    if (a === null || b === null) {
      skipped += 1;
      continue;
    }
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined) {
      throw new RangeError(
        `item ${item}: label '${i === undefined ? a : b}' is not a declared category`,
      );
    }
    table[i]![j]! += 1;
    pairs += 1;
  }
  return { categories, table, pairs, skipped };
}

function checkTable(table: AgreementTable): number {
  const q = table.length;
  if (q < 2) throw new RangeError("agreement needs at least two categories");
  let total = 0;
  for (const row of table) {
    if (row.length !== q) throw new RangeError("the agreement table is not square");
    for (const count of row) {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(`table counts must be non-negative integers, got ${count}`);
      }
      total += count;
    }
  }
  if (total === 0) throw new RangeError("the agreement table is empty");
  return total;
}

function observed(table: AgreementTable, total: number): number {
  let diagonal = 0;
  for (let i = 0; i < table.length; i++) diagonal += table[i]![i]!;
  return diagonal / total;
}

/** The share of items on which both raters chose the same category. */
export function rawAgreement(table: AgreementTable): number {
  return observed(table, checkTable(table));
}

/**
 * Cohen's kappa, unweighted: (p_o − p_e) / (1 − p_e), with p_e from each rater's own marginal
 * shares. NaN when p_e = 1, that is, when both raters put every item in the same category: chance
 * then explains all agreement and kappa is undefined.
 */
export function cohenKappa(table: AgreementTable): number {
  const total = checkTable(table);
  const po = observed(table, total);
  let pe = 0;
  for (let k = 0; k < table.length; k++) {
    let row = 0;
    let column = 0;
    for (let j = 0; j < table.length; j++) {
      row += table[k]![j]!;
      column += table[j]![k]!;
    }
    pe += (row / total) * (column / total);
  }
  return pe === 1 ? Number.NaN : (po - pe) / (1 - pe);
}

/**
 * Gwet's AC1 for two raters: (p_o − p_e) / (1 − p_e), with p_e = Σ_k π_k (1 − π_k) / (q − 1),
 * where π_k is the share of all labels, from both raters, in category k and q is the number of
 * declared categories (the table's size). Unlike kappa it stays stable when one category is rare.
 */
export function gwetAc1(table: AgreementTable): number {
  const total = checkTable(table);
  const q = table.length;
  const po = observed(table, total);
  let sum = 0;
  for (let k = 0; k < q; k++) {
    let row = 0;
    let column = 0;
    for (let j = 0; j < q; j++) {
      row += table[k]![j]!;
      column += table[j]![k]!;
    }
    const pi = (row + column) / (2 * total);
    sum += pi * (1 - pi);
  }
  const pe = sum / (q - 1);
  return (po - pe) / (1 - pe);
}

/** The distance metrics of Krippendorff's alpha. */
export type AlphaMetric = "nominal" | "ordinal" | "interval";

/**
 * Krippendorff's alpha, 1 − D_o / D_e, over a reliability matrix: one row per unit (item), one
 * entry per rater, null for a missing value. Any number of raters, and missing values, are allowed.
 * A unit with fewer than two values cannot be paired and is left out. The ordinal metric uses the
 * frequencies of the values in between (Krippendorff 2011), so the numbers only need to be in
 * order; the interval metric uses their differences. NaN when fewer than two values can be paired
 * or when every paired value is the same: alpha is then undefined.
 */
export function krippendorffAlpha(
  units: readonly (readonly (number | null)[])[],
  metric: AlphaMetric,
): number {
  const pairable = units
    .map((unit) => unit.filter((value): value is number => value !== null))
    .filter((values) => values.length >= 2);
  for (const values of pairable) {
    for (const value of values) {
      if (!Number.isFinite(value))
        throw new RangeError(`values must be finite numbers, got ${value}`);
    }
  }
  const levels = [...new Set(pairable.flat())].toSorted((a, b) => a - b);
  if (levels.length === 0) return Number.NaN;
  const at = new Map(levels.map((level, i) => [level, i]));
  const v = levels.length;

  // The coincidence matrix: each ordered pair of values within a unit, weighted 1 / (m_u − 1).
  const coincidence = new Float64Array(v * v);
  for (const values of pairable) {
    const weight = 1 / (values.length - 1);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values.length; j++) {
        if (i !== j) coincidence[at.get(values[i]!)! * v + at.get(values[j]!)!]! += weight;
      }
    }
  }
  const margin = new Float64Array(v);
  for (let c = 0; c < v; c++) for (let k = 0; k < v; k++) margin[c]! += coincidence[c * v + k]!;
  let n = 0;
  for (let c = 0; c < v; c++) n += margin[c]!;
  if (n < 2) return Number.NaN;

  const distance = (c: number, k: number): number => {
    if (c === k) return 0;
    if (metric === "nominal") return 1;
    if (metric === "interval") return (levels[c]! - levels[k]!) ** 2;
    const low = Math.min(c, k);
    const high = Math.max(c, k);
    let between = 0;
    for (let g = low; g <= high; g++) between += margin[g]!;
    return (between - (margin[low]! + margin[high]!) / 2) ** 2;
  };

  let disagreementObserved = 0;
  let disagreementExpected = 0;
  for (let c = 0; c < v; c++) {
    for (let k = 0; k < v; k++) {
      const d = distance(c, k);
      disagreementObserved += coincidence[c * v + k]! * d;
      disagreementExpected += margin[c]! * margin[k]! * d;
    }
  }
  if (disagreementExpected === 0) return Number.NaN;
  return 1 - ((n - 1) * disagreementObserved) / disagreementExpected;
}
