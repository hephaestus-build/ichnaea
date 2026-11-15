import {
  type Case,
  type CaseSet,
  caseDigest,
  caseSetDigest,
  type Configuration,
  configurationIdentity,
  digest,
  Plan,
  type Suite,
} from "@hephaestus-build/ichnaea-contracts";

import { testMeasure } from "./measures.ts";
import type { MeasureDefinition } from "./plugin.ts";

/** Thrown when a suite cannot be resolved into a valid plan. The message names the fix. */
export class PlanError extends Error {
  override readonly name = "PlanError";
}

/** Everything a plan is resolved from. */
export interface PlanInput {
  readonly suite: Suite;
  readonly caseSet: CaseSet;
  readonly cases: readonly Case[];
  readonly arms: ReadonlyArray<{
    readonly name: string;
    readonly role: "base" | "candidate" | "reference";
    readonly configuration: Configuration;
  }>;
  /** Arms whose trials will be run (not imported); their calls count against the budget. */
  readonly armsToRun?: readonly string[];
  readonly measures: ReadonlyMap<string, MeasureDefinition>;
  readonly trigger: Plan["trigger"];
  readonly seed: number;
  readonly now: string;
  readonly ichnaea: string;
  /** Calls left this month on the endpoint, from the call ledger. */
  readonly monthlyRemaining?: number;
}

/**
 * Resolves a suite into a locked plan (REQ-16, REQ-19, REQ-21, REQ-49): every planned trial is
 * listed before the first call, the worst-case calls are computed, and the estimand's conditions
 * are checked. `sampled-cases` on curated or promoted cases is refused. A `fixed-cases` suite
 * with one replicate, or a plan with one arm, runs estimate-only. Primary measures must be known
 * and must have passed their tester (REQ-33).
 */
export async function createPlan(input: PlanInput): Promise<Plan> {
  const { suite } = input;
  const pools = new Set(suite.pools ?? ["development", "validation", "promoted"]);
  const byId = new Map(input.cases.map((c) => [c.id as string, c]));

  const entries = input.caseSet.cases;
  if ((await caseSetDigest(entries)) !== input.caseSet.digest)
    throw new PlanError(`case set '${input.caseSet.id}': its digest does not match its entries`);
  if (suite.caseSet.digest && suite.caseSet.digest !== input.caseSet.digest) {
    throw new PlanError(
      `suite '${suite.id}' pins case set digest ${suite.caseSet.digest}, but the case set is ${input.caseSet.digest}`,
    );
  }
  for (const entry of entries) {
    const c = byId.get(entry.id);
    if (!c) throw new PlanError(`case '${entry.id}' is listed in the case set but missing`);
    if ((await caseDigest(c)) !== entry.digest)
      throw new PlanError(`case '${entry.id}' does not match its digest in the case set`);
  }
  const selected = entries.filter((e) => pools.has(e.pool)).map((e) => byId.get(e.id) as Case);
  if (selected.some((c) => c.pool === "sealed"))
    throw new PlanError(
      "a sealed pool runs only in a locked confirmatory plan, which this plan is not",
    );
  if (selected.length === 0) throw new PlanError(`suite '${suite.id}' selects no case`);

  if (suite.estimand === "sampled-cases") {
    const curated = selected.filter((c) => c.provenance.selection !== "random");
    if (curated.length > 0) {
      throw new PlanError(
        `sampled-cases needs a randomly drawn pool, but ${curated.length} case(s) are ${curated[0]?.provenance.selection}; use fixed-cases`,
      );
    }
  }
  for (const primary of suite.primary) {
    const measure = input.measures.get(primary.measure);
    if (!measure)
      throw new PlanError(`primary measure '${primary.measure}' is not provided by any plugin`);
    // A measure with examples is tested here, now. One without (computed by the application)
    // must carry the application's tester result on its card.
    const status = measure.examples
      ? (await testMeasure(measure)).status
      : measure.card.validation?.tester?.status;
    if (status !== "passed") {
      throw new PlanError(
        `primary measure '${primary.measure}' has no passing known-good and known-bad test; run 'ichnaea doctor' to see why`,
      );
    }
  }
  if (input.arms.filter((a) => a.role === "base").length > 1)
    throw new PlanError("a plan has at most one base arm");

  const arms = await Promise.all(
    input.arms.map(async (a) => ({
      name: a.name,
      role: a.role,
      identity: await configurationIdentity(a.configuration),
      configuration: a.configuration,
    })),
  );
  const comparing = arms.some((a) => a.role === "base") && arms.some((a) => a.role === "candidate");
  const decidable = comparing && (suite.estimand === "sampled-cases" || suite.replicates >= 2);

  const trials: Array<{ id: string; case: string; arm: string; replicate: number; batch: number }> =
    [];
  for (let replicate = 0; replicate < suite.replicates; replicate++) {
    for (const c of selected) {
      for (const [k, arm] of arms.entries()) {
        // Alternating batches: replicate r runs every case under every arm before r + 1 (REQ-25).
        trials.push({
          id: `${c.id}/${arm.name}/r${replicate}`,
          case: c.id,
          arm: arm.name,
          replicate,
          batch: replicate * arms.length + k,
        });
      }
    }
  }
  const running = new Set(input.armsToRun ?? arms.map((a) => a.name));
  const worstCaseCalls =
    trials.filter((t) => running.has(t.arm)).length * suite.budget.callsPerTrial;

  const measures = [...suite.primary.map((p) => p.measure), ...(suite.secondary ?? [])].map(
    (id) => {
      const card = input.measures.get(id)?.card;
      return { kind: "measure" as const, id, version: card?.version ?? "unknown" };
    },
  );

  return Plan.parse({
    schema: "ichnaea.plan/1",
    suite: suite.id,
    suiteVersion: suite.version,
    suiteDigest: await digest(suite),
    caseSet: input.caseSet.id,
    caseSetDigest: input.caseSet.digest,
    trigger: input.trigger,
    mode: decidable ? "decision" : "estimate-only",
    estimand: suite.estimand,
    alpha: suite.alpha ?? 0.05,
    replicates: suite.replicates,
    arms,
    measures,
    primary: suite.primary,
    secondary: suite.secondary ?? [],
    hardGates: suite.hardGates ?? [],
    policy: suite.policy,
    power: [],
    budget: {
      worstCaseCalls,
      maxCalls: suite.budget.maxCalls,
      ...(input.monthlyRemaining === undefined ? {} : { monthlyRemaining: input.monthlyRemaining }),
    },
    trials,
    seed: { algorithm: "mt19937", value: String(input.seed) },
    createdAt: input.now,
    ichnaea: input.ichnaea,
  });
}
