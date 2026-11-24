import { expect, it } from "vitest";

import { digest, PlanDigest } from "../../src/contracts/index.ts";
import { decide } from "../../src/decide/index.ts";
import { configuration, scenario } from "./support/scenario.ts";

const at = "2026-11-15T12:00:00Z";

it("legacy A/A citations cannot admit an unrandomized comparison", async () => {
  const stable = { cases: 20, replicates: 1, base: () => 1, candidate: () => 1 };
  const aa = await Promise.all(
    ["aa-1", "aa-2"].map(async (id) => {
      const records = await scenario({
        ...stable,
        runId: id,
        candidateConfig: () => configuration("model-a"),
      });
      return {
        plan: records.plan,
        run: records.run,
        decision: decide({ ...records, decidedAt: at, ichnaea: "0.0.0" }),
      };
    }),
  );
  const comparison = await scenario({ ...stable, candidate: () => 0 });
  const plan = {
    ...comparison.plan,
    aa: { decisions: aa.map(({ decision }) => ({ run: decision.run, digest: digest(decision) })) },
  };
  const run = { ...comparison.run, plan: PlanDigest.parse(digest(plan)) };
  expect(decide({ ...comparison, plan, run, decidedAt: at, ichnaea: "0.0.0" })).toMatchObject({
    mode: "estimate-only",
    verdict: null,
    reason: expect.stringContaining("no locked randomized assignments"),
  });
});
