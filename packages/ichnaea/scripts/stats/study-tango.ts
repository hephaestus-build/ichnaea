// Simulation study: one-sided 95% lower bounds of Tango's paired score interval, with and without
// Laud's skewness correction. Usage: node scripts/stats/study-tango.ts <reps>
import { createRng, tangoInterval } from "../../src/stats/index.ts";

const reps = Number(process.argv[2] ?? 2000);
let seed = 1;
const rows: string[] = [];
const summary = { plain: [] as number[], skew: [] as number[] };
for (const n of [15, 30, 60, 100, 250]) {
  for (const [p11, p10, p01] of [
    [0.8, 0.05, 0.05],
    [0.6, 0.15, 0.1],
    [0.9, 0, 0.05],
    [0.5, 0.1, 0.2],
    [0.7, 0.1, 0.1],
    [0.95, 0.02, 0.02],
    [0.4, 0.3, 0.2],
    [0.85, 0.1, 0],
  ] as const) {
    for (const [name, skew] of [
      ["plain", false],
      ["skew", true],
    ] as const) {
      const rng = createRng(seed++);
      let hits = 0;
      for (let i = 0; i < reps; i++) {
        const t = { both: 0, candidateOnly: 0, baseOnly: 0, neither: 0 };
        for (let j = 0; j < n; j++) {
          const u = rng.uniform();
          if (u < p11) t.both++;
          else if (u < p11 + p10) t.candidateOnly++;
          else if (u < p11 + p10 + p01) t.baseOnly++;
          else t.neither++;
        }
        if (tangoInterval(t, 0.95, "lower", skew).lower <= p10 - p01 + 1e-12) hits++;
      }
      summary[name].push(hits / reps);
      rows.push(`${n}\t${p11},${p10},${p01}\t${name}\t${(hits / reps).toFixed(4)}`);
    }
  }
}
console.log(rows.join("\n"));
for (const [k, v] of Object.entries(summary))
  console.log(
    k,
    "min",
    Math.min(...v).toFixed(4),
    "mean",
    (v.reduce((a, b) => a + b, 0) / v.length).toFixed(4),
  );
