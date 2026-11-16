import type { HeroCard } from "../../src/hero/render.ts";

// The support example's regressed run, in the card copy of UX-CARDS § 3.1 (measured). It stands in
// for the card.json that `report` writes, until that output lands. Cases 03, 06 and 09 broke.
export const broken = new Set(["support-03", "support-06", "support-09"]);

export const regressed: HeroCard = {
  title: "✗ Support answers · REGRESSION",
  evidence: {
    sentence:
      "Facts stated decreased by 25 points (100% → 75%) on these 12 cases, 3 trials per arm.",
    scope: "on these 12 cases, 3 trials per arm",
  },
  statistical: [
    "The paired decrease is beyond run-to-run noise (exact test, p < 0.001).",
    "This does not establish that the loss exceeds the 15-point margin.",
    "Until the margin check is validated, any decrease beyond run-to-run noise counts as worse.",
  ],
  policy: { line: "CI policy: block. Inspect the 3 changed cases before merging." },
  reasons: ["REGRESSION_DETECTED"],
  measure: {
    change: {
      estimate: -0.25,
      shown: "−25 points",
      bound: { value: -0.41, validity: "descriptive", shown: "−41 points" },
    },
    margin: 0.15,
    cases: Array.from({ length: 12 }, (_, i) => {
      const id = `support-${String(i + 1).padStart(2, "0")}`;
      return {
        case: id,
        base: { successes: 3, trials: 3 },
        candidate: { successes: broken.has(id) ? 0 : 3, trials: 3 },
      };
    }),
  },
};
