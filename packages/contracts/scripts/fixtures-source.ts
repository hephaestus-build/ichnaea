// The source of the shared contract fixtures. `write-fixtures.ts` writes them as JSON files, which
// every validator (zod, ajv, and later a Java consumer) reads. The application is synthetic: a
// support assistant that answers questions about a fictional product.

const d = (c: string): string => `sha256:${c.repeat(64).slice(0, 64)}`;
const config = d("c1");
const configB = d("c2");

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
  configuration: {
    schema: "ichnaea.configuration/1",
    description: "Support assistant: retrieval over the help centre, one answer model.",
    models: [
      {
        role: "answer",
        provider: { value: "openai-compatible", status: "pinned", part: "model" },
        id: { value: "example-model-2026-10", status: "pinned", part: "model" },
      },
    ],
    parameters: {
      "answer.temperature": { value: 0.2, status: "pinned", part: "parameter" },
      "answer.maxTokens": { value: 800, status: "pinned", part: "parameter" },
    },
    prompts: [{ name: "answer", digest: d("e1"), status: "pinned" }],
    factors: {
      "code.commit": { value: "4f2a9c1", status: "pinned", part: "code" },
      "data.helpCentre": { value: d("f1"), status: "observed", part: "data" },
    },
    label: "current",
  },
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
        marginReason: "A 5-point drop is the largest the owners accept.",
      },
    ],
    hardGates: ["support/schema-valid"],
    budget: { maxCalls: 600, callsPerTrial: 2 },
    policy: {
      onRegression: "block",
      onInconclusive: "report",
      onEstimateOnly: "report",
      onInvalid: "block",
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
    mode: "decision",
    estimand: "fixed-cases",
    alpha: 0.05,
    replicates: 3,
    arms: [
      { name: "base", configuration: config },
      { name: "candidate", configuration: configB },
    ],
    measures: [{ kind: "measure", id: "support/facts-correct", version: "1.0.0", digest: d("12") }],
    power: [
      {
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
    budget: { worstCaseCalls: 720, maxCalls: 800 },
    trials: [{ id: "t-0001", case: "refund-window-de", arm: "candidate", replicate: 0, batch: 0 }],
    seed: { algorithm: "mt19937", value: 20261115 },
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
  run: {
    schema: "ichnaea.run/1",
    id: "run-2026-11-15-a",
    plan: d("13"),
    exploratory: false,
    environment: { node: "24.22.2", platform: "linux-x64", ichnaea: "0.1.0" },
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
    value: 1,
    source: "ichnaea",
    dataClass: "none",
  },
  decision: {
    schema: "ichnaea.decision/1",
    mode: "decision",
    verdict: "PASS",
    reason: "Every primary measure is non-inferior and every hard gate passed.",
    plan: d("13"),
    run: "run-2026-11-15-a",
    runDigest: d("14"),
    base: config,
    candidate: configB,
    differingFactors: ["prompt.answer"],
    alpha: 0.05,
    measures: [
      {
        measure: "support/facts-correct",
        version: "1.0.0",
        estimand: "fixed-cases",
        base: {
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
        candidate: {
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
        difference: {
          estimate: 0.01,
          lower: -0.02,
          upper: { nonFinite: "inf" },
          level: 0.95,
          sided: "lower",
          method: "stratified-mn",
        },
        margin: 0.05,
        safetyMargin: 0,
        verdict: "NON-INFERIOR",
        coverage: 0.994,
        flips: [{ case: "refund-window-de", direction: "negative", base: 1, candidate: 0.33 }],
        notes: [],
      },
    ],
    gates: [{ gate: "support/schema-valid", passed: true, failures: 0 }],
    power: [],
    missingness: { base: 0, candidate: 1, differs: false, sensitivity: "unchanged" },
    invalidReasons: [],
    limitations: [
      "An observed model identity cannot detect a silent update behind the same identity.",
    ],
    seed: { algorithm: "mt19937", value: 20261115 },
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
    value: true,
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
    "unknown-unit": (r) => (r["unit"] = "conversation"),
    "wrong-schema-id": (r) => (r["schema"] = "ichnaea.case/2"),
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
    "factor-without-status": (r) =>
      delete (
        (r["parameters"] as Record<string, Record<string, unknown>>)[
          "answer.temperature"
        ] as Record<string, unknown>
      )["status"],
    "unknown-status": (r) => {
      (r["factors"] as Record<string, Record<string, unknown>>)["code.commit"]!["status"] =
        "assumed";
    },
  },
  suite: {
    "missing-policy-inconclusive": (r) =>
      delete (r["policy"] as Record<string, unknown>)["onInconclusive"],
    "zero-replicates": (r) => (r["replicates"] = 0),
    "unknown-estimand": (r) => (r["estimand"] = "population"),
    "negative-margin": (r) =>
      ((r["primary"] as Array<Record<string, unknown>>)[0]!["margin"] = -0.05),
    "margin-without-reason": (r) =>
      delete (r["primary"] as Array<Record<string, unknown>>)[0]!["marginReason"],
    "unnamespaced-measure": (r) =>
      ((r["primary"] as Array<Record<string, unknown>>)[0]!["measure"] = "facts"),
  },
  plan: {
    "no-arms": (r) => (r["arms"] = []),
    "bad-seed": (r) => (r["seed"] = { algorithm: "mt19937", value: -1 }),
    "local-time": (r) => (r["createdAt"] = "2026-11-15T10:00:00+01:00"),
  },
  trial: {
    "unknown-outcome": (r) => (r["outcome"] = "skipped"),
    "missing-configuration": (r) => delete r["configuration"],
    "negative-tokens": (r) => ((r["usage"] as Record<string, unknown>)["inputTokens"] = -1),
    "missing-data-class": (r) => delete r["dataClass"],
    "fractional-replicate": (r) => (r["replicate"] = 0.5),
  },
  run: {
    "unknown-ledger-state": (r) =>
      ((r["ledger"] as Array<Record<string, unknown>>)[0]!["state"] = "skipped"),
    "missing-lineage": (r) => delete r["lineage"],
  },
  measureCard: {
    "missing-construct": (r) => delete r["construct"],
    "unknown-tier": (r) => (r["tier"] = "headline"),
    "bad-version": (r) => (r["version"] = "1.0"),
  },
  measureValue: {
    "string-value": (r) => (r["value"] = "1"),
    "bad-non-finite": (r) => (r["value"] = { nonFinite: "infinity" }),
  },
  decision: {
    "unknown-verdict": (r) => (r["verdict"] = "PASSED"),
    "level-out-of-range": (r) =>
      ((
        (r["measures"] as Array<Record<string, unknown>>)[0]!["difference"] as Record<
          string,
          unknown
        >
      )["level"] = 1.5),
    "missing-missingness": (r) => delete r["missingness"],
  },
  judge: {
    "zero-repeats": (r) => (r["repeats"] = 0),
    "missing-rubric": (r) => delete r["rubricDigest"],
  },
  label: {
    "missing-rater": (r) => delete r["rater"],
    "object-value": (r) => (r["value"] = { yes: true }),
  },
  calibration: {
    "unknown-status": (r) => (r["status"] = "trusted"),
    "negative-confusion": (r) => (r["confusion"] = [[-1]]),
  },
  monitor: {
    "missing-owner": (r) => delete r["owner"],
    "missing-action": (r) => delete r["action"],
    "zero-budget": (r) => (r["falseAlarmsPerYear"] = 0),
  },
  finding: {
    "unknown-promotion": (r) => (r["promotion"] = "auto"),
  },
};
