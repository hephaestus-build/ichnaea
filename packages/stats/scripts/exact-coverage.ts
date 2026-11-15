// Prints the exact coverage of the fixed-cases lower bound for few cases. Usage:
//   node scripts/exact-coverage.ts
import { exactCoverage } from "../test/support/exact.ts";

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
