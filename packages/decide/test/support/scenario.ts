// Builds complete, valid records for a synthetic application, so decisions are tested end to end.
import {
  Case,
  type CaseSet,
  caseDigest,
  caseSetDigest,
  type Configuration,
  digest,
  type GateResult,
  type MeasureValue,
  type Plan,
  Run,
  type Suite,
  type Trial,
} from "@hephaestus-build/ichnaea-contracts";
import { createPlan, type MeasureDefinition } from "@hephaestus-build/ichnaea-core";
import { createRng } from "@hephaestus-build/ichnaea-stats";

export const configuration = (model: string): Configuration => ({
  schema: "ichnaea.configuration/1",
  description: "A synthetic answer assistant",
  models: [
    {
      role: "answer",
      provider: { value: "example", status: "pinned" },
      id: { value: model, status: "pinned" },
    },
  ],
  parameters: [{ name: "temperature", value: 0, status: "pinned", origin: "explicit" }],
  prompts: [],
  factors: {},
});

const card = (id: string): MeasureDefinition => ({
  card: {
    id,
    version: "1.0.0",
    construct: "c",
    operationalDefinition: "o",
    valueType: "binary",
    unit: "proportion",
    direction: "higher",
    justification: "j",
    errorModel: "e",
    applicability: "all cases",
    tier: "primary",
    unitOfEvaluation: "turn",
    establishes: "e",
    computedBy: "application",
    validation: {
      tester: {
        status: "passed",
        digest: `sha256:${"e".repeat(64)}`,
        ranAt: "2026-11-15T00:00:00Z",
      },
    },
  },
});

export interface ScenarioOptions {
  readonly cases: number;
  readonly replicates: number;
  /** Per-case pass rate of the base and the candidate, by case index. */
  readonly base: (i: number) => number;
  readonly candidate: (i: number) => number;
  readonly margin?: number;
  readonly safetyMargin?: number;
  readonly measures?: readonly string[];
  readonly gates?: readonly GateResult[];
  readonly hardGates?: readonly string[];
  /** Outcome override per planned trial, for missing data and failures. */
  readonly outcome?: (trial: {
    case: string;
    arm: string;
    replicate: number;
  }) => Trial["outcome"] | undefined;
  readonly estimand?: "fixed-cases" | "sampled-cases";
  readonly selection?: "curated" | "random";
  readonly seed?: number;
  readonly maxCalls?: number;
}

export interface Scenario {
  readonly plan: Plan;
  readonly run: Run;
  readonly trials: Trial[];
  readonly values: MeasureValue[];
  readonly gates: GateResult[];
  readonly cases: Case[];
  readonly caseSet: CaseSet;
  readonly suite: Suite;
}

export async function scenario(o: ScenarioOptions): Promise<Scenario> {
  const measureIds = o.measures ?? ["app/correct"];
  const cases: Case[] = Array.from({ length: o.cases }, (_, i) => ({
    schema: "ichnaea.case/1",
    id: `case-${String(i).padStart(3, "0")}`,
    unit: "turn",
    dataClass: "none",
    input: { question: `question ${i}` },
    provenance: {
      source: "authored",
      selection: o.selection ?? "curated",
      created: "2026-11-01",
      licence: "CC0-1.0",
      exposure: "public",
    },
    pool: "development",
  })).map((c) => Case.parse(c));
  const entries = await Promise.all(
    cases.map(async (c) => ({ id: c.id, digest: await caseDigest(c), pool: c.pool })),
  );
  const caseSet = {
    schema: "ichnaea.caseSet/1",
    id: "synthetic",
    digest: await caseSetDigest(entries),
    cases: entries,
  } as CaseSet;
  const suite = {
    schema: "ichnaea.suite/1",
    id: "synthetic",
    version: "1",
    objective: "o",
    construct: "c",
    decision: "d",
    scope: "s",
    nonCoverage: "n",
    estimand: o.estimand ?? "fixed-cases",
    caseSet: { id: "synthetic", path: "cases.jsonl" },
    replicates: o.replicates,
    primary: measureIds.map((m) => ({
      measure: m,
      margin: o.margin ?? 0.1,
      marginReason: "test",
      ...(o.safetyMargin === undefined ? {} : { safetyMargin: o.safetyMargin }),
    })),
    hardGates: o.hardGates ?? [],
    budget: { maxCalls: o.maxCalls ?? 100_000, callsPerTrial: 1 },
    policy: {
      onRegression: "block",
      onInconclusive: "report",
      onEstimateOnly: "report",
      onInvalid: "block",
    },
    measureReviewDate: "2027-01-01",
  } as Suite;
  const plan = await createPlan({
    suite,
    caseSet,
    cases,
    arms: [
      { name: "base", role: "base", configuration: configuration("model-a") },
      { name: "candidate", role: "candidate", configuration: configuration("model-b") },
    ],
    measures: new Map(measureIds.map((m) => [m, card(m)])),
    trigger: "code",
    seed: o.seed ?? 7,
    now: "2026-11-15T10:00:00Z",
    ichnaea: "0.0.0",
  });
  const rng = createRng(o.seed ?? 7);
  const trials: Trial[] = [];
  const values: MeasureValue[] = [];
  for (const t of plan.trials) {
    const index = Number(t.case.slice(5));
    const outcome =
      o.outcome?.({ case: t.case, arm: t.arm, replicate: t.replicate }) ?? "completed";
    const identity = plan.arms.find((a) => a.name === t.arm)?.identity as string;
    trials.push({
      schema: "ichnaea.trial/1",
      id: t.id,
      source: "offline",
      run: "run-1",
      case: t.case,
      unit: "turn",
      configuration: identity,
      arm: t.arm,
      replicate: t.replicate,
      outcome,
      dataClass: "none",
    } as Trial);
    if (outcome !== "completed" && outcome !== "abstained") continue;
    const p = t.arm === "base" ? o.base(index) : o.candidate(index);
    for (const m of measureIds) {
      values.push({
        schema: "ichnaea.measureValue/1",
        trial: t.id,
        measure: m,
        version: "1.0.0",
        applicable: true,
        value: { type: "binary", pass: rng.uniform() < p },
        source: "application",
        dataClass: "none",
      } as MeasureValue);
    }
  }
  const run = Run.parse({
    schema: "ichnaea.run/1",
    id: "run-1",
    plan: await digest(plan),
    exploratory: false,
    environment: { node: "24", platform: "test", ichnaea: "0.0.0" },
    arms: plan.arms,
    lineage: [],
    ledger: trials.map((t) => ({ trial: t.id, state: "recorded", outcome: t.outcome })),
    startedAt: "2026-11-15T10:00:00Z",
  });
  return { plan, run, trials, values, gates: [...(o.gates ?? [])], cases, caseSet, suite };
}
