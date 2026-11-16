// Prints the exact coverage of the fixed-cases lower bound for few cases. Usage:
//   node scripts/stats/exact-coverage.ts
import { exactCoverage, exactPatternCoverage } from "../../test/stats/support/exact.ts";

for (const k of [1, 2, 3, 4, 5, 6, 8]) {
  for (const r of [2, 3]) {
    const rows: string[] = [];
    let min = 1;
    for (const p of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
      for (const shift of [0, -0.05, -0.1, -0.2]) {
        if (p + shift < 0) continue;
        const c = exactCoverage(k, r, p, p + shift);
        min = Math.min(min, c);
        if (c < 0.945) rows.push(`p=${p} shift=${shift}: ${c.toFixed(4)}`);
      }
    }
    console.log(
      `k=${k} r=${r}: exact minimum ${min.toFixed(4)}${rows.length ? `  (below 0.945: ${rows.join("; ")})` : ""}`,
    );
  }
}

// Every case with 2 trials in one arm and 3 in the other, on the rates and shifts of the CI grid
// (VALIDATION.md, "The validated domain").
for (const k of [5, 6, 7, 8, 9, 10]) {
  for (const [candidateTrials, baseTrials] of [
    [3, 2],
    [2, 3],
  ] as const) {
    let min = { value: 1, at: "" };
    for (const p of [0.05, 0.2, 0.5, 0.7, 0.9, 0.99]) {
      for (const shift of [0.1, 0, -0.05, -0.1, -0.2, -0.3]) {
        const q = p + shift;
        if (q < 0 || q > 1) continue;
        const c = exactPatternCoverage([{ count: k, candidateTrials, baseTrials }], p, q);
        if (c < min.value) min = { value: c, at: `p=${p} shift=${shift}` };
      }
    }
    console.log(
      `k=${k}, candidate ${candidateTrials} trials against base ${baseTrials}: exact minimum ${min.value.toFixed(4)} at ${min.at}`,
    );
  }
}
