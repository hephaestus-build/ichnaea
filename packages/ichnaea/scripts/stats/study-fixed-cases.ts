// Simulation study: one-sided 95% lower bounds of the stratified score interval under the
// fixed-cases estimand, for four method variants, and the regression tests' type-I error.
// Usage: node scripts/stats/study-fixed-cases.ts <reps> <out.json>
import { writeFileSync } from "node:fs";

import {
  createRng,
  exactStratifiedTest,
  scoreDifferenceInterval,
  scoreDifferenceTest,
  type Rng,
  type Stratum,
} from "../../src/stats/index.ts";

const reps = Number(process.argv[2] ?? 2000);
const out = process.argv[3] ?? "study-fixed-cases.json";
const alpha = 0.05;

function binomial(rng: Rng, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (rng.uniform() < p) s++;
  return s;
}

function scenarios(k: number): Array<{ name: string; rates: number[] }> {
  const rng = createRng(1000 + k);
  const mixture = Array.from({ length: k }, (_, i) =>
    i < Math.round(0.7 * k) ? 1 : i < Math.round(0.9 * k) ? 0.8 : 0.3,
  );
  const beta = Array.from({ length: k }, () => {
    // Beta(8, 2) by order statistics of uniforms: the 8th of 9 is Beta(8, 2).
    const u = Array.from({ length: 9 }, () => rng.uniform()).toSorted((a, b) => a - b);
    return u[7] as number;
  });
  return [
    ...[0.5, 0.7, 0.9, 0.97, 1].map((p) => ({
      name: `p=${p}`,
      rates: Array.from({ length: k }, () => p),
    })),
    { name: "mixture", rates: mixture },
    { name: "beta(8,2)", rates: beta },
  ];
}

const variants = [
  { name: "mn", options: { skewnessCorrection: false, biasCorrection: true } },
  { name: "mee", options: { skewnessCorrection: false, biasCorrection: false } },
  { name: "scas", options: { skewnessCorrection: true, biasCorrection: false } },
  { name: "scas-bc", options: { skewnessCorrection: true, biasCorrection: true } },
];

const onlyK = process.env["STUDY_K"] ? Number(process.env["STUDY_K"]) : undefined;
const onlyR = process.env["STUDY_R"] ? Number(process.env["STUDY_R"]) : undefined;
const rows: Array<Record<string, unknown>> = [];
let seed = 1 + 100_000 * (onlyK ?? 0) + 1000 * (onlyR ?? 0);
for (const k of [10, 17, 30, 60].filter((x) => onlyK === undefined || x === onlyK)) {
  for (const r of [2, 3, 5].filter((x) => onlyR === undefined || x === onlyR)) {
    for (const scenario of scenarios(k)) {
      for (const shift of [0, -0.05, -0.1]) {
        const cand = scenario.rates.map((p) => Math.min(1, Math.max(0, p + shift)));
        const truth = cand.reduce((a, p, i) => a + p - (scenario.rates[i] as number), 0) / k;
        if (shift !== 0 && Math.abs(truth - shift) > 0.02) continue; // clipped too much: skip
        const rng = createRng(seed++);
        const covered = variants.map(() => 0);
        let exactReject = 0;
        let scoreReject = 0;
        for (let i = 0; i < reps; i++) {
          const strata: Stratum[] = scenario.rates.map((p, j) => ({
            candidate: { successes: binomial(rng, r, cand[j] as number), trials: r },
            base: { successes: binomial(rng, r, p), trials: r },
          }));
          variants.forEach((v, vi) => {
            const lower = scoreDifferenceInterval(strata, 1 - alpha, "lower", v.options).lower;
            if (lower <= truth + 1e-12) covered[vi] = (covered[vi] as number) + 1;
          });
          if (shift === 0) {
            if (exactStratifiedTest(strata, "less").p <= alpha) exactReject++;
            if (scoreDifferenceTest(strata, 0, "less", variants[2]!.options).p <= alpha)
              scoreReject++;
          }
        }
        const row: Record<string, unknown> = {
          k,
          r,
          scenario: scenario.name,
          shift,
          truth: Number(truth.toFixed(4)),
        };
        variants.forEach((v, vi) => (row[v.name] = (covered[vi] as number) / reps));
        if (shift === 0) {
          row["typeI.exact"] = exactReject / reps;
          row["typeI.scas"] = scoreReject / reps;
        }
        rows.push(row);
        process.stdout.write(".");
      }
    }
  }
}
writeFileSync(out, JSON.stringify({ reps, alpha, rows }, null, 1));
const summary = variants.map((v) => {
  const values = rows.map((row) => row[v.name] as number);
  return `${v.name}: min ${Math.min(...values).toFixed(4)} mean ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)}`;
});
console.log(`\n${rows.length} points, ${reps} reps\n${summary.join("\n")}`);
