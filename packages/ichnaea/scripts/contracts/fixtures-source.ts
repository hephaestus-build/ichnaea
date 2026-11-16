// The source of the shared contract fixtures. `write-fixtures.ts` writes them as JSON files, which
// every validator (zod, ajv, and later a Java consumer) reads. The application is synthetic: a
// support assistant that answers questions about a fictional product.

import { sha256 } from "../../src/contracts/canonical.ts";

const d = (c: string): string => `sha256:${c.repeat(64).slice(0, 64)}`;
const config = d("c1");
const configB = d("c2");

const CONFIGURATION = {
  schema: "ichnaea.configuration/1",
  description: "Support assistant: retrieval over the help centre, one answer model.",
  models: [
    {
      role: "answer",
      provider: { value: "openai-compatible", status: "pinned" },
      id: { value: "example-model-2026-10", status: "pinned" },
    },
  ],
  parameters: [
    { name: "answer.temperature", value: 0.2, status: "pinned", origin: "explicit" },
    { name: "answer.maxTokens", value: 800, status: "pinned", origin: "explicit" },
    { name: "answer.topP", value: 1, status: "declared", origin: "default" },
  ],
  prompts: [{ name: "answer", digest: d("e1"), status: "pinned" }],
  factors: {
    "code.commit": { value: "4f2a9c1", status: "pinned", part: "code" },
    "data.helpCentre": { value: d("f1"), status: "observed", part: "data" },
  },
  label: "current",
};

// The candidate resolved its prompt to text, so it carries the text with its URI. The digest is the
// digest of the text: validation by schema cannot check that, `verifyConfiguration` does.
const CANDIDATE_TEMPLATE = "Answer from the help centre only. Be brief.\n";

export const CONFIGURATION_B = {
  ...CONFIGURATION,
  prompts: [
    {
      name: "answer",
      digest: await sha256(CANDIDATE_TEMPLATE),
      status: "pinned",
      template: CANDIDATE_TEMPLATE,
      uri: "file:prompts/answer.txt",
    },
  ],
  label: "candidate",
};

export const VALID: Record<string, Record<string, unknown>> = {
  case: {
    schema: "ichnaea.case/1",
    id: "refund-window-de",
    caseSet: "support-answers",
    unit: "session",
    dataClass: "none",
    input: { question: "Kann ich nach 40 Tagen noch zurückgeben?", lang: "de" },
    turns: [{ role: "user", content: "Und mit Kassenbon?" }],
    fixtures: [{ name: "policy.md", digest: d("a1") }],
    references: { facts: [{ text: "Return window is 30 days", polarity: "positive" }] },
    family: "refund-window",
    slices: { lang: "de", intent: "returns" },
    criticality: "high",
    provenance: {
      source: "authored",
      selection: "curated",
      author: "suite maintainers",
      created: "2026-11-01",
      licence: "CC-BY-4.0",
      exposure: "public",
    },
    pool: "development",
    validation: { status: "reviewed" },
  },
  caseSet: {
    schema: "ichnaea.caseSet/1",
    id: "support-answers",
    version: "3",
    digest: d("b1"),
    cases: [
      { id: "refund-window-de", digest: d("a2"), pool: "development", family: "refund-window" },
      { id: "refund-window-en", digest: d("a3"), pool: "development", family: "refund-window" },
    ],
  },
  configuration: CONFIGURATION,
  suite: {
    schema: "ichnaea.suite/1",
    id: "support-answers",
    version: "1",
    objective: "Answers about returns stay correct when the assistant changes.",
    construct: "Factual correctness of answers against the help centre.",
    decision: "Merge or hold a change to the assistant.",
    scope: "Questions about returns and refunds in German and English.",
    nonCoverage: "Tone, latency under load, other topics.",
    estimand: "fixed-cases",
    caseSet: { id: "support-answers", path: "cases/support-answers.jsonl" },
    replicates: 3,
    primary: [
      {
        measure: "support/facts-correct",
        margin: 0.05,
        marginStatus: "registered",
        marginReason: "A 5-point drop is the largest the owners accept.",
      },
    ],
    hardGates: ["support/schema-valid"],
    budget: { maxCalls: 600, callsPerTrial: 2 },
    policy: {
      onRegression: "block",
      onInconclusive: "report",
      onEstimateOnly: "report",
    },
    measureReviewDate: "2027-05-01",
  },
  plan: {
    schema: "ichnaea.plan/1",
    suite: "support-answers",
    suiteVersion: "1",
    suiteDigest: d("11"),
    caseSet: "support-answers",
    caseSetDigest: d("b1"),
    trigger: "code",
    varies: [],
    mode: "decision",
    modeReasons: [],
    estimand: "fixed-cases",
    alpha: 0.05,
    replicates: 3,
    arms: [
      { name: "base", role: "base", identity: config, configuration: CONFIGURATION },
      { name: "candidate", role: "candidate", identity: configB, configuration: CONFIGURATION_B },
    ],
    measures: [{ kind: "measure", id: "support/facts-correct", version: "1.0.0", digest: d("12") }],
    power: [
      {
        computed: true,
        measure: "support/facts-correct",
        applicableCases: 60,
        replicates: 3,
        margin: 0.05,
        mde: 0.031,
        floor: 0.015,
        assumption: "within-case variance of run 2026-11-10",
        decidable: true,
      },
    ],
    primary: [
      {
        measure: "support/facts-correct",
        margin: 0.05,
        marginStatus: "registered",
        marginReason: "A 5-point drop is the largest the owners accept.",
      },
    ],
    secondary: [],
    hardGates: ["support/schema-valid"],
    policy: {
      onRegression: "block",
      onInconclusive: "report",
      onEstimateOnly: "report",
    },
    budget: { worstCaseCalls: 720, maxCalls: 800 },
    trials: [
      {
        id: "t-0001",
        case: "refund-window-de",
        family: "refund-window",
        arm: "candidate",
        replicate: 0,
        batch: 0,
      },
    ],
    seed: { algorithm: "mt19937", value: "20261115" },
    createdAt: "2026-11-15T10:00:00Z",
    ichnaea: "0.1.0",
  },
  trial: {
    schema: "ichnaea.trial/1",
    id: "t-0001",
    source: "offline",
    run: "run-2026-11-15-a",
    case: "refund-window-de",
    unit: "session",
    configuration: configB,
    arm: "candidate",
    replicate: 0,
    outcome: "completed",
    dataClass: "none",
    input: { question: "Kann ich nach 40 Tagen noch zurückgeben?" },
    output: { text: "Nein, die Frist beträgt 30 Tage.", sources: ["policy.md"] },
    steps: [
      {
        kind: "model_call",
        model: "example-model-2026-10",
        outcome: "ok",
        inputTokens: 812,
        outputTokens: 64,
      },
    ],
    usage: { calls: 1, inputTokens: 812, outputTokens: 64, wallMs: 1830 },
    observed: [
      {
        name: "model.answer.returnedId",
        value: "example-model-2026-10",
        expected: "example-model-2026-10",
      },
    ],
    cache: { hit: false },
    startedAt: "2026-11-15T10:01:00Z",
    endedAt: "2026-11-15T10:01:02Z",
  },
  trialRequest: {
    schema: "ichnaea.trialRequest/1",
    dataClass: "none",
    plan: d("f1"),
    trial: {
      id: "refund-window-de/candidate/r0",
      suite: "support-assistant",
      case: "refund-window-de",
      arm: "candidate",
      replicate: 0,
      attempt: 1,
    },
    case: {
      id: "refund-window-de",
      digest: d("a7"),
      unit: "session",
      input: { question: "Kann ich nach 40 Tagen noch zurückgeben?" },
    },
    limits: { calls: 12 },
  },
  trialResult: {
    schema: "ichnaea.trialResult/1",
    dataClass: "none",
    trial: {
      id: "refund-window-de/candidate/r0",
      suite: "support-assistant",
      case: "refund-window-de",
      arm: "candidate",
      replicate: 0,
      attempt: 1,
    },
    output: { text: "Nein, die Frist beträgt 30 Tage.", sources: ["policy.md"] },
    calls: 3,
    observed: {
      code: { commit: "0123456789abcdef0123456789abcdef01234567" },
      model: "example-model-2026-10",
      route: d("e1"),
      parameters: { temperature: 0 },
    },
  },
  run: {
    schema: "ichnaea.run/1",
    id: "run-2026-11-15-a",
    plan: d("13"),
    exploratory: false,
    environment: { node: "24.22.2", platform: "linux-x64", ichnaea: "0.1.0" },
    arms: [],
    lineage: [{ kind: "plugin", id: "support", version: "0.1.0" }],
    ledger: [{ trial: "t-0001", state: "recorded", outcome: "completed" }],
    startedAt: "2026-11-15T10:00:30Z",
    completedAt: "2026-11-15T10:20:00Z",
  },
  measureCard: {
    schema: "ichnaea.measureCard/1",
    id: "support/facts-correct",
    version: "1.0.0",
    construct: "The answer states every gold fact of the case and contradicts none.",
    operationalDefinition:
      "1 if all positive gold facts are entailed and no negative fact is, else 0.",
    valueType: "binary",
    unit: "proportion",
    direction: "higher",
    justification: "Wrong return rules cost money and trust.",
    errorModel: "Paraphrases can be missed by the literal matcher.",
    applicability: "Cases with at least one gold fact.",
    tier: "primary",
    unitOfEvaluation: "session",
    establishes: "Agreement with the gold facts, not helpfulness.",
    computedBy: "ichnaea",
  },
  measureValue: {
    schema: "ichnaea.measureValue/1",
    trial: "t-0001",
    measure: "support/facts-correct",
    version: "1.0.0",
    applicable: true,
    value: { type: "binary", pass: true },
    source: "ichnaea",
    dataClass: "none",
  },
  decision: {
    schema: "ichnaea.decision/1",
    mode: "decision",
    verdict: "PASS",
    reason: "Every primary measure is non-inferior and every hard gate passed.",
    scope: "on these 2 cases, beyond run-to-run noise",
    plan: d("13"),
    run: "run-2026-11-15-a",
    runDigest: d("14"),
    arms: [
      { name: "base", role: "base", identity: config },
      { name: "candidate", role: "candidate", identity: configB },
    ],
    differingFactors: ["prompt.answer"],
    alpha: 0.05,
    measures: [
      {
        measure: "support/facts-correct",
        version: "1.0.0",
        tier: "primary",
        estimand: "fixed-cases",
        arms: [
          {
            arm: "base",
            rate: {
              estimate: 0.9,
              lower: 0.86,
              upper: 0.93,
              level: 0.95,
              sided: "two",
              method: "wilson",
            },
            availability: { planned: 180, available: 180, notApplicable: 0, missing: 0 },
          },
          {
            arm: "candidate",
            rate: {
              estimate: 0.91,
              lower: 0.87,
              upper: 0.94,
              level: 0.95,
              sided: "two",
              method: "wilson",
            },
            availability: { planned: 180, available: 179, notApplicable: 0, missing: 1 },
          },
        ],
        comparisons: [
          {
            base: "base",
            candidate: "candidate",
            difference: {
              estimate: 0.01,
              lower: -0.02,
              upper: 1,
              level: 0.95,
              sided: "lower",
              method: "stratified-score-rd-bc",
            },
            margin: 0.05,
            safetyMargin: 0,
            nonInferiorityP: 0.004,
            regressionP: 0.71,
            regressionPAdjusted: 0.71,
            regressionMethod: "exact-stratified-conditional",
            regression: { validated: true, limitations: [] },
            nonInferiority: { validated: true, limitations: [] },
            flips: [{ case: "refund-window-de", direction: "negative", base: 1, candidate: 0.33 }],
          },
        ],
        verdict: "NON-INFERIOR",
        coverage: 0.994,
        sensitivity: [
          {
            imputation: "against-non-inferiority",
            difference: {
              estimate: 0.004,
              lower: -0.027,
              upper: 1,
              level: 0.95,
              sided: "lower",
              method: "stratified-score-rd-bc",
            },
            nonInferiorityP: 0.006,
            regressionPAdjusted: 0.62,
            regression: { validated: true, limitations: [] },
            nonInferiority: { validated: true, limitations: [] },
            verdict: "NON-INFERIOR",
            changesVerdict: false,
          },
          {
            imputation: "against-regression",
            difference: {
              estimate: 0.012,
              lower: -0.018,
              upper: 1,
              level: 0.95,
              sided: "lower",
              method: "stratified-score-rd-bc",
            },
            nonInferiorityP: 0.003,
            regressionPAdjusted: 0.78,
            regression: { validated: true, limitations: [] },
            nonInferiority: { validated: true, limitations: [] },
            verdict: "NON-INFERIOR",
            changesVerdict: false,
          },
        ],
        notes: [],
      },
    ],
    gates: [{ gate: "support/schema-valid", passed: true, failures: 0 }],
    power: {
      planning: [
        {
          computed: true,
          measure: "support/facts-correct",
          applicableCases: 60,
          replicates: 3,
          margin: 0.05,
          mde: 0.018,
          floor: 0.018,
          assumption: "planning: no noise, every case applicable, trials per case 3 (60 cases)",
          decidable: true,
        },
      ],
      run: [
        {
          computed: true,
          measure: "support/facts-correct",
          applicableCases: 60,
          replicates: 3,
          margin: 0.05,
          mde: 0.034,
          floor: 0.018,
          assumption:
            "per-case pass rates of the base arm in this run, trials per case 3 (60 cases)",
          decidable: true,
        },
      ],
    },
    missingness: {
      byArm: [
        { arm: "base", missing: 0, planned: 180 },
        { arm: "candidate", missing: 1, planned: 180 },
      ],
      differs: false,
      sensitivity: "unchanged",
    },
    invalidReasons: [],
    limitations: [
      "An observed model identity cannot detect a silent update behind the same identity.",
    ],
    seed: { algorithm: "mt19937", value: "20261115" },
    decidedAt: "2026-11-15T10:21:00Z",
    ichnaea: "0.1.0",
    dataClass: "none",
  },
  judge: {
    schema: "ichnaea.judge/1",
    id: "support/grounded",
    version: "1.0.0",
    evaluatorKind: "model",
    model: { provider: "openai-compatible", id: "example-judge-2026-09" },
    endpointClass: "deployment-gateway",
    promptDigest: d("15"),
    rubricDigest: d("16"),
    outputSchema: { type: "object", properties: { verdict: { enum: ["yes", "no", "unknown"] } } },
    outputKind: "binary",
    parameters: { temperature: 0 },
    swapOrder: false,
    repeats: 1,
  },
  label: {
    schema: "ichnaea.label/1",
    trial: "t-0001",
    measure: "support/grounded",
    value: { type: "binary", pass: true },
    rater: "psn1_r_7k3q2m9x4c8v1b5n6z0a2s4d",
    raterRole: "expert",
    source: "bundle",
    rubricDigest: d("16"),
    labelledAt: "2026-11-15T12:00:00Z",
    dataClass: "none",
  },
  calibration: {
    schema: "ichnaea.calibration/1",
    judge: "support/grounded",
    judgeDigest: d("17"),
    measure: "support/grounded",
    calibrationSet: d("18"),
    humanHuman: [{ statistic: "cohen-kappa", estimate: 0.71, lower: 0.6, upper: 0.81, n: 120 }],
    judgeHuman: [{ statistic: "cohen-kappa", estimate: 0.68, lower: 0.56, upper: 0.79, n: 120 }],
    confusion: [
      [70, 8],
      [9, 33],
    ],
    tolerance: 0.1,
    status: "calibrated",
    expiry: ["judge change", "output distribution shift"],
    createdAt: "2026-11-15T13:00:00Z",
  },
  monitor: {
    schema: "ichnaea.monitor/1",
    id: "support-refusal-rate",
    measure: "support/refused",
    sampling: "census",
    statistic: "bernoulli-cusum",
    parameters: { k: 0.02, h: 4.1 },
    reference: 0.03,
    falseAlarmsPerYear: 1,
    practicalMargin: 0.02,
    owner: "support on-call",
    action: "Check the help-centre sync, then the model route.",
    severity: "warning",
  },
  finding: {
    schema: "ichnaea.finding/1",
    id: "f-0001",
    source: "canary",
    trials: ["t-0001"],
    pointers: ["run-2026-11-15-a/t-0001"],
    failureClass: "wrong return window",
    confirmedAt: "2026-11-15T14:00:00Z",
    confirmerRole: "suite maintainer",
    promotion: "synthetic",
  },
};

type Mutation = (record: Record<string, unknown>) => void;

/** Invalid variants of each valid fixture: each must fail in every validator. */
export const INVALID: Record<string, Record<string, Mutation>> = {
  case: {
    "missing-unit": (r) => delete r["unit"],
    "reused-without-dataset": (r) =>
      (r["provenance"] = { ...(r["provenance"] as object), source: "reused" }),
    "reused-without-limits": (r) =>
      (r["provenance"] = {
        ...(r["provenance"] as object),
        source: "reused",
        reusedDataset: { name: "public help pages" },
      }),
    "missing-created": (r) => delete (r["provenance"] as Record<string, unknown>)["created"],
    "missing-exposure": (r) => delete (r["provenance"] as Record<string, unknown>)["exposure"],
    "missing-provenance-licence": (r) =>
      delete (r["provenance"] as Record<string, unknown>)["licence"],
    "bad-fixture-digest": (r) => (r["fixtures"] = [{ name: "x", digest: "md5:abc" }]),
    "empty-id": (r) => (r["id"] = ""),
  },
  caseSet: {
    "no-cases": (r) => (r["cases"] = []),
    "bad-digest": (r) => (r["digest"] = "sha256:XYZ"),
  },
  configuration: {
    "missing-models": (r) => delete r["models"],
    "empty-models": (r) => (r["models"] = []),
    "missing-parameters": (r) => delete r["parameters"],
    "no-parameters": (r) => (r["parameters"] = []),
    "empty-model-id": (r) =>
      ((r["models"] as Array<Record<string, Record<string, unknown>>>)[0]!["id"]!["value"] = ""),
    "null-model-id": (r) =>
      ((r["models"] as Array<Record<string, Record<string, unknown>>>)[0]!["id"]!["value"] = null),
    "factor-without-status": (r) =>
      delete (r["factors"] as Record<string, Record<string, unknown>>)["code.commit"]!["status"],
    "parameter-without-origin": (r) =>
      delete (r["parameters"] as Array<Record<string, unknown>>)[0]!["origin"],
  },
  suite: {
    "replicates-for-without-reason": (r) => {
      r["replicatesFor"] = [{ slice: "group", value: "small", replicates: 3 }];
    },
    "replicates-for-zero-trials": (r) => {
      r["replicatesFor"] = [{ slice: "group", value: "small", replicates: 0, reason: "r" }];
    },
    "missing-policy-inconclusive": (r) =>
      delete (r["policy"] as Record<string, unknown>)["onInconclusive"],
    "zero-replicates": (r) => (r["replicates"] = 0),
    "estimand-not-a-string": (r) => (r["estimand"] = ["fixed-cases"]),
    "negative-margin": (r) =>
      ((r["primary"] as Array<Record<string, unknown>>)[0]!["margin"] = -0.05),
    "margin-without-status": (r) =>
      delete (r["primary"] as Array<Record<string, unknown>>)[0]!["marginStatus"],
    "margin-without-reason": (r) =>
      delete (r["primary"] as Array<Record<string, unknown>>)[0]!["marginReason"],
    "unnamespaced-measure": (r) =>
      ((r["primary"] as Array<Record<string, unknown>>)[0]!["measure"] = "facts"),
  },
  plan: {
    "no-arms": (r) => (r["arms"] = []),
    "bad-seed": (r) => (r["seed"] = { algorithm: "mt19937", value: "-1" }),
    "date-without-time": (r) => (r["createdAt"] = "2026-11-15"),
    "arm-without-configuration": (r) =>
      delete (r["arms"] as Array<Record<string, unknown>>)[0]!["configuration"],
    "schedule-without-concurrency": (r) => (r["schedule"] = { concurrency: 0, endpoint: "e" }),
    "aa-citation-without-digest": (r) => (r["aa"] = { decisions: [{ run: "aa-1" }] }),
  },
  trial: {
    "outcome-not-a-string": (r) => (r["outcome"] = 3),
    "missing-configuration": (r) => delete r["configuration"],
    "negative-tokens": (r) => ((r["usage"] as Record<string, unknown>)["inputTokens"] = -1),
    "missing-data-class": (r) => delete r["dataClass"],
    "fractional-replicate": (r) => (r["replicate"] = 0.5),
  },
  trialRequest: {
    "attempt-zero": (r) => ((r["trial"] as Record<string, unknown>)["attempt"] = 0),
    "missing-case-digest": (r) => delete (r["case"] as Record<string, unknown>)["digest"],
  },
  trialResult: {
    "missing-calls": (r) => delete r["calls"],
    "negative-calls": (r) => (r["calls"] = -1),
    "route-as-url": (r) =>
      ((r["observed"] as Record<string, unknown>)["route"] = "https://api.example.com/v1"),
    "short-commit": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = { commit: "0123456" }),
    "code-without-commit-or-image": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = {}),
  },
  run: {
    "missing-ledger": (r) => delete r["ledger"],
    "missing-lineage": (r) => delete r["lineage"],
  },
  measureCard: {
    "missing-construct": (r) => delete r["construct"],
    "missing-direction": (r) => delete r["direction"],
    "bad-version": (r) => (r["version"] = "1.0"),
  },
  measureValue: {
    "non-finite-misspelt": (r) => (r["value"] = { type: "score", value: { nonFinite: "NaN" } }),
    "untagged-value": (r) => (r["value"] = 1),
  },
  decision: {
    "no-arms": (r) => (r["arms"] = []),
    "level-out-of-range": (r) => {
      const outcome = (
        r["measures"] as Array<{ comparisons: Array<{ difference: Record<string, unknown> }> }>
      )[0]!;
      outcome.comparisons[0]!.difference["level"] = 1.5;
    },
    "missing-missingness": (r) => delete r["missingness"],
    "power-as-a-list": (r) => (r["power"] = []),
    "run-power-not-a-number": (r) => {
      const power = r["power"] as { run: Array<Record<string, unknown>> };
      power.run[0]!["mde"] = { nonFinite: "nan" };
    },
    "not-computed-without-reason": (r) => {
      const power = r["power"] as { run: Array<Record<string, unknown>> };
      power.run[0] = { ...power.run[0], computed: false };
    },
    "unnamed-validated": (r) => {
      const comparison = (
        r["measures"] as Array<{ comparisons: Array<Record<string, unknown>> }>
      )[0]!.comparisons[0]!;
      delete comparison["regression"];
      delete comparison["nonInferiority"];
      comparison["validated"] = true;
    },
    "not-validated-without-reason": (r) => {
      const comparison = (
        r["measures"] as Array<{ comparisons: Array<Record<string, unknown>> }>
      )[0]!.comparisons[0]!;
      comparison["nonInferiority"] = { validated: false, limitations: [] };
    },
    "validated-with-a-limitation": (r) => {
      const comparison = (
        r["measures"] as Array<{ comparisons: Array<Record<string, unknown>> }>
      )[0]!.comparisons[0]!;
      comparison["regression"] = { validated: true, limitations: ["fewer than 5 cases"] };
    },
  },
  judge: {
    "zero-repeats": (r) => (r["repeats"] = 0),
    "missing-rubric": (r) => delete r["rubricDigest"],
  },
  label: {
    "missing-rater": (r) => delete r["rater"],
    "untagged-value": (r) => (r["value"] = true),
  },
  calibration: {
    "missing-status": (r) => delete r["status"],
    "negative-confusion": (r) => (r["confusion"] = [[-1]]),
  },
  monitor: {
    "missing-owner": (r) => delete r["owner"],
    "missing-action": (r) => delete r["action"],
    "zero-budget": (r) => (r["falseAlarmsPerYear"] = 0),
  },
  finding: {
    "missing-promotion": (r) => delete r["promotion"],
  },
};

/** A planning entry that a decision states for a plan without one, whose margin is refused. */
const REFUSED_PLANNING = {
  computed: false,
  measure: "support/facts-correct",
  applicableCases: 60,
  replicates: 3,
  margin: 0.35,
  reason: "the plan carries no planning statement, and its margin is refused",
  refusal:
    "primary measure 'support/facts-correct': its margin of 0.35 less its safety margin of 0 is above the validated margin ceiling of 0.3, where no non-inferiority result is validated",
};

/** Further valid records: shapes the main valid fixture does not show. */
export const VALID_EXTRA: Record<string, Record<string, Mutation>> = {
  plan: {
    "one-trial-schedule-and-aa": (r) => {
      r["schedule"] = { concurrency: 4, endpoint: "example-endpoint" };
      r["aa"] = {
        decisions: [
          { run: "aa-1", digest: d("31") },
          { run: "aa-2", digest: d("32") },
        ],
      };
    },
  },
  decision: {
    "planning-margin-refused": (r) => {
      (r["power"] as { planning: unknown[] }).planning = [REFUSED_PLANNING];
    },
  },
  suite: {
    "more-trials-for-a-slice": (r) => {
      r["replicates"] = 2;
      r["replicatesFor"] = [
        {
          slice: "group",
          value: "small",
          replicates: 3,
          reason: "a measure that applies to these 17 cases; 3 trials lower its floor",
        },
      ];
    },
  },
  trial: {
    online: (r) => {
      r["source"] = "online";
      r["case"] = null;
      delete r["run"];
      delete r["arm"];
      delete r["caseDigest"];
      delete r["input"];
      delete r["output"];
      r["pointer"] = "app://interaction/42";
      r["dataClass"] = "pseudonymous";
    },
  },
  measureValue: {
    "non-finite-score": (r) => (r["value"] = { type: "score", value: { nonFinite: "-inf" } }),
  },
  trialResult: {
    "infrastructure-failure": (r) => {
      delete r["output"];
      r["failure"] = {
        class: "infrastructure",
        kind: "rate-limited",
        message: "429 from the endpoint",
      };
      r["calls"] = 1;
    },
    "image-released-service": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = { image: d("b2") }),
    "commit-and-image": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = {
        commit: "0123456789abcdef0123456789abcdef01234567",
        image: d("b2"),
      }),
    "with-usage": (r) => (r["usage"] = { inputTokens: 812, outputTokens: 64 }),
    "output-behind-pointer": (r) => {
      delete r["output"];
      r["pointer"] = "trace://composer/8f2c";
    },
    // A malformed request is the harness's fault: class protocol, never a system failure.
    "bad-request": (r) => {
      delete r["output"];
      r["failure"] = { class: "protocol", kind: "bad-request" };
      r["calls"] = 0;
    },
  },
  label: { "rater-cannot-tell": (r) => (r["value"] = { type: "unknown" }) },
  run: {
    "runtime-and-arch": (r) => {
      r["environment"] = {
        node: "24.22.2",
        platform: "linux-x64",
        ichnaea: "0.1.0",
        arch: "x64",
        runtime: { name: "node", version: "24.22.2", platform: "linux", arch: "x64" },
      };
    },
  },
  configuration: {
    "model-version-route-and-informational": (r) => {
      const model = (r["models"] as Array<Record<string, unknown>>)[0]!;
      model["version"] = { value: "2026-10-01", status: "pinned" };
      model["route"] = { value: "primary", status: "declared" };
      r["informational"] = { "provider.fingerprint": "fp_3c1a" };
    },
  },
};

/**
 * Variants that a writer must not produce but a reader must accept (REQ-05): values added to an
 * enumeration in a later minor version, and members the writer schema does not define.
 */
export const READER_ONLY: Record<string, Record<string, Mutation>> = {
  configuration: {
    // Statuses outside a field's enumeration read as a value a later minor version may add.
    "uncontrollable-model-id": (r) =>
      ((r["models"] as Array<Record<string, Record<string, unknown>>>)[0]!["id"]!["status"] =
        "uncontrollable"),
    "observed-model-id": (r) =>
      ((r["models"] as Array<Record<string, Record<string, unknown>>>)[0]!["id"]!["status"] =
        "observed"),
    "observed-parameter": (r) =>
      ((r["parameters"] as Array<Record<string, unknown>>)[0]!["status"] = "observed"),
    "misspelt-model-member": (r) =>
      ((r["models"] as Array<Record<string, unknown>>)[0]!["versoin"] = {
        value: "2026-10",
        status: "pinned",
      }),
    "misplaced-top-level-member": (r) => (r["tools"] = ["search"]),
  },
  case: {
    "future-unit": (r) => (r["unit"] = "conversation"),
    "future-provenance-source": (r) =>
      (r["provenance"] = { ...(r["provenance"] as object), source: "scraped" }),
  },
  measureValue: { "future-value-kind": (r) => (r["value"] = { type: "ranking", order: [2, 1] }) },
  label: {
    "future-preference-value": (r) => (r["value"] = { type: "preference", preferred: "both" }),
  },
  trial: { "future-outcome": (r) => (r["outcome"] = "partial") },
  trialRequest: {
    // Scoring comes from the base suite: a writer never sends a case's references.
    "case-with-references": (r) =>
      ((r["case"] as Record<string, unknown>)["references"] = { answer: "30 Tage" }),
    // The request never says which side an arm is; a reader ignores a role if one is sent.
    "arm-role": (r) => (r["arm"] = { name: "candidate", role: "candidate" }),
  },
  trialResult: {
    // Ichnaea measures the times itself (REQ-25): a worker never sends them, and a reader ignores
    // them as unknown members.
    "worker-start-time": (r) => (r["startedAt"] = "2026-11-15T10:00:00Z"),
    "worker-end-time": (r) => (r["endedAt"] = "2026-11-15T10:00:05Z"),
    // The base suite scores the output: a worker sends no score, and a reader ignores one.
    "worker-score": (r) => (r["values"] = { "support/facts-stated": true }),
    "future-failure-class": (r) => (r["failure"] = { class: "quality", kind: "wrong-answer" }),
  },
  run: {
    "future-ledger-state": (r) =>
      ((r["ledger"] as Array<Record<string, unknown>>)[0]!["state"] = "skipped"),
  },
  measureCard: { "future-tier": (r) => (r["tier"] = "headline") },
  decision: {
    "future-verdict": (r) => (r["verdict"] = "PASS-WITH-NOTES"),
    // Only the refused reason carries a refusal; on another reason it is an unknown member.
    "refusal-with-another-reason": (r) => {
      (r["power"] as { planning: unknown[] }).planning = [
        {
          ...REFUSED_PLANNING,
          reason: "the plan carries no planning statement, and none can be computed from it",
        },
      ];
    },
  },
  calibration: { "future-status": (r) => (r["status"] = "provisional") },
  finding: { "future-promotion": (r) => (r["promotion"] = "auto") },
  suite: { "future-estimand": (r) => (r["estimand"] = "population") },
};
