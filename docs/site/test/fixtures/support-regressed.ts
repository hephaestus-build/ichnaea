import type { HeroInput } from "../../src/hero/render.ts";

// The support example's regressed run: 12 cases, 3 trials per arm, cases 03, 06 and 09 broke.
export const broken = new Set(["support-03", "support-06", "support-09"]);
export const regressed: HeroInput = {
  title: "✗ Support answers · REGRESSION",
  evidence: "Facts stated decreased by 25 points (100% → 75%) on these 12 cases, 3 trials per arm.",
  footer: "CI policy: block · exit code 1 · reason REGRESSION_DETECTED",
  cases: Array.from({ length: 12 }, (_, i) => {
    const id = `support-${String(i + 1).padStart(2, "0")}`;
    return { id, base: [1, 1, 1], candidate: broken.has(id) ? [0, 0, 0] : [1, 1, 1] };
  }),
  change: { estimate: -0.25, bound: -0.41, validated: false },
  margin: 0.15,
};
