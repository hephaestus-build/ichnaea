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

const COMMIT = "9e2c1f0a4b7d3e6c8a1f2b5d7e9c0a3b6d8f1e2c";

/** A project config with two datasets, a shared worker, an endpoint, baselines and delivery. */
const PROJECT = {
  schema: "ichnaea.project/1",
  suites: ["suites/*/suite.ts"],
  datasets: {
    "answers-public": { git: { repo: "https://github.com/example/answers-eval", commit: COMMIT } },
    "answers-private": {
      git: {
        repo: "git@github.com:example/answers-eval-private.git",
        commit: "41ab0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b",
      },
    },
  },
  workers: {
    assistant: {
      command: ["poetry", "run", "python", "-m", "evals.worker"],
      prepare: ["poetry", "install", "--no-root"],
      env: [{ name: "LLM_API_KEY", secret: true }],
      endpoints: ["eu-llm"],
      capacity: 4,
    },
  },
  endpoints: { "eu-llm": { concurrency: 8, requestsPerMinute: 600 } },
  baselines: {
    from: { githubArtifact: { workflow: "baseline.yml", branch: "main" } },
    freshness: "P7D",
  },
  defaults: { trials: 2, mode: "fast" },
  delivery: {
    sinks: { pr: { kind: "github" } },
    routes: [{ on: "compare", profile: "pr", to: ["pr"] }],
  },
  privacy: { homeKey: { fromEnv: "ICHNAEA_HOME_KEY" } },
};

/** A RAG answer suite: cases from two datasets, a judge, a TypeScript scorer and three profiles. */
const SUITE_V2 = {
  schema: "ichnaea.suite/2",
  id: "answers",
  version: "4",
  about: {
    objective: "Answers about study programmes are correct and grounded in the official pages.",
    decision: "Release check before a deploy of a new model, prompt or retrieval setting.",
    construct: "Grounded correctness on curated questions; not user satisfaction.",
    scope: "German and English questions about admission and programmes.",
    nonCoverage: ["multi-turn follow-ups", "small talk"],
    threats: ["judge bias", "retrieval drift between runs"],
  },
  cases: {
    from: [
      { dataset: "answers-public", path: "answers/cases.jsonl" },
      { dataset: "answers-private", path: "answers/real.jsonl" },
    ],
    pools: { development: { label: "dev" }, validation: { label: "test", maxReads: 40 } },
  },
  worker: "assistant",
  stages: ["search", "rank", "answer"],
  environment: {
    index: {
      service: { fromEnv: "INDEX_URL" },
      identity: "snapshot-id",
      class: "none",
      exposure: "public",
    },
  },
  instruments: {
    "quality-judge": {
      command: ["poetry", "run", "python", "-m", "judges.quality"],
      prepare: ["poetry", "install", "--no-root"],
      files: ["judges/**", "rubrics/quality.md", "pyproject.toml", "poetry.lock"],
      judge: {
        model: "provider/model-x@2026-10-01",
        prompt: "judges/prompt.md",
        rubric: "rubrics/quality.md",
        parameters: { temperature: 0 },
      },
      env: [{ name: "JUDGE_API_KEY", secret: true }],
      endpoints: ["eu-llm"],
    },
    "ts-scorers": { files: ["scorers/**", "package-lock.json"] },
  },
  measures: {
    searched: {
      type: "binary",
      stage: "search",
      status: "ok",
      appliesTo: { slice: "needs-search" },
      direction: "higher",
    },
    grounded: { type: "binary", scorer: { builtin: "links-grounded" } },
    "cites-page": {
      type: "binary",
      scorer: { instrument: "ts-scorers", module: "scorers/cites.ts", export: "citesPage" },
    },
    correct: { type: "binary", scorer: { instrument: "quality-judge", dimension: "correctness" } },
    "rank-ndcg": { type: "score", stage: "rank", scorer: { builtin: "ndcg", options: { k: 5 } } },
    "latency-ms": { type: "quantity", unit: "ms", scorer: { builtin: "wall-time" } },
  },
  policy: {
    primary: {
      grounded: {
        limit: 0.05,
        owner: "answers-owner",
        reason: "Pass needs any drop to stay under 5 points.",
      },
      searched: {
        limit: 0.1,
        owner: "answers-owner",
        reason: "Search is how answers get grounded.",
      },
    },
    secondary: ["latency-ms"],
    diagnostic: ["correct", "rank-ndcg", "cites-page"],
  },
  profiles: {
    try: { trials: 1, pool: "development", cases: 10 },
    pr: { trials: 2, pool: "development", mode: "fast" },
    release: { trials: 2, pool: "validation", mode: "confirm" },
  },
  budget: { calls: 2000, callsPerTrial: 12, judgeCalls: 600 },
  stopReasons: {
    COMPLETED: "completed",
    RATE_LIMITED: "infrastructure",
    NO_RESULTS: "system",
    SEARCH_SKIPPED: "not_invoked",
  },
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
      // An opaque arm name, as a plan assigns it: never base or candidate (REQ-22).
      id: "refund-window-de/b/r0",
      suite: "support-assistant",
      case: "refund-window-de",
      arm: "b",
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
    deadline: "PT120S",
    workdir: "/tmp/ichnaea/run-2026-11-15-a/trial-0001",
    configuration: { path: "/work/support-assistant/configs/answer-short.json" },
  },
  trialResult: {
    schema: "ichnaea.trialResult/1",
    dataClass: "none",
    trial: {
      // An opaque arm name, as a plan assigns it: never base or candidate (REQ-22).
      id: "refund-window-de/b/r0",
      suite: "support-assistant",
      case: "refund-window-de",
      arm: "b",
      replicate: 0,
      attempt: 1,
    },
    output: { text: "Nein, die Frist beträgt 30 Tage.", sources: ["policy.md"] },
    events: [
      {
        stage: "search",
        iteration: 0,
        ran: true,
        output: { pages: ["policy.md"] },
        startedAt: "2026-11-15T10:01:00.120Z",
        endedAt: "2026-11-15T10:01:00.480Z",
        stop: { reason: "completed" },
      },
      { stage: "answer", iteration: 0, ran: true, stop: { reason: "end_turn" } },
    ],
    stop: { reason: "end_turn" },
    usage: {
      calls: 3,
      inputTokens: 812,
      outputTokens: 64,
      cacheReadTokens: 512,
      responseIds: ["resp_01", "resp_02", "resp_03"],
      throttled: { count: 0, ms: 0, firstAcceptedAt: "2026-11-15T10:01:00.100Z" },
    },
    timing: {
      startedAt: "2026-11-15T10:01:00.050Z",
      firstChunkAt: "2026-11-15T10:01:01.200Z",
      endedAt: "2026-11-15T10:01:02.000Z",
    },
    observed: {
      code: { commit: "0123456789abcdef0123456789abcdef01234567" },
      model: "example-model-2026-10",
      route: d("e1"),
      parameters: { temperature: 0 },
      configuration: d("c3"),
      configurationRead: ["answer.prompt", "answer.temperature"],
      environment: { helpCentreIndex: "snapshot-2026-11-01" },
    },
  },
  workerError: { schema: "ichnaea.workerError/1", dataClass: "none", kind: "bad-json" },
  workerReady: { schema: "ichnaea.workerReady/1", capacity: 2, protocol: "ichnaea.trialRequest/1" },
  workerEvent: {
    schema: "ichnaea.workerEvent/1",
    trial: {
      // An opaque arm name, as a plan assigns it: never base or candidate (REQ-22).
      id: "refund-window-de/a/r1",
      suite: "support-assistant",
      case: "refund-window-de",
      arm: "a",
      replicate: 1,
      attempt: 1,
    },
    kind: "heartbeat",
    calls: 2,
  },
  cancel: {
    schema: "ichnaea.cancel/1",
    trial: {
      // An opaque arm name, as a plan assigns it: never base or candidate (REQ-22).
      id: "refund-window-de/a/r1",
      suite: "support-assistant",
      case: "refund-window-de",
      arm: "a",
      replicate: 1,
      attempt: 2,
    },
  },
  scoreRequest: {
    schema: "ichnaea.scoreRequest/1",
    id: "score-0001",
    dataClass: "none",
    instrument: "quality-judge",
    deadline: "PT120S",
    settings: { judge: { model: "example-judge-2026-10", temperature: 0 } },
    measures: [
      { id: "correct", dimension: "correctness" },
      { id: "complete", dimension: "completeness" },
    ],
    case: {
      id: "refund-window-de",
      input: { question: "Kann ich nach 40 Tagen noch zurückgeben?" },
      references: { facts: [{ text: "Return window is 30 days", polarity: "positive" }] },
    },
    scratch: "/tmp/ichnaea/run-2026-11-15-a/score-0001",
    units: [
      {
        trial: "refund-window-de/b/r0",
        output: { text: "Nein, die Frist beträgt 30 Tage.", sources: ["policy.md"] },
        artifacts: [
          { name: "exercise", path: "/tmp/ichnaea/run-2026-11-15-a/score-0001/exercise" },
        ],
        events: [{ stage: "answer", iteration: 0, ran: true, stop: { reason: "end_turn" } }],
      },
    ],
  },
  scoreResult: {
    schema: "ichnaea.scoreResult/1",
    request: "score-0001",
    dataClass: "none",
    values: [
      {
        trial: "refund-window-de/b/r0",
        measure: "correct",
        status: "ok",
        value: true,
        why: "States the 30-day window from the policy.",
        observed: { model: "example-judge-2026-10", responseIds: ["resp_j1"] },
      },
      {
        trial: "refund-window-de/b/r0",
        measure: "complete",
        status: "ok",
        value: 0.5,
        observed: { model: "example-judge-2026-10", responseIds: ["resp_j2"] },
      },
      {
        trial: "refund-window-de/a/r0",
        measure: "complete",
        status: "not_applicable",
        why: "The case asks one question.",
      },
    ],
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
  // The v2 records: a RAG answer suite and its project config (synthetic content).
  "suite.2": SUITE_V2,
  "configuration.2": {
    schema: "ichnaea.configuration/2",
    digest: d("c3"),
    fields: { model: "example-model-2026-10", temperature: 0.2 },
  },
  project: PROJECT,
  "suite.lock": {
    schema: "ichnaea.suite.lock/1",
    suite: "answers",
    suiteDigest: d("d1"),
    measurementDigest: d("d2"),
    sources: [
      {
        origin: { dataset: "answers-public", path: "answers/cases.jsonl" },
        digest: d("d3"),
        bytes: 48211,
        pools: { development: 40, validation: 20 },
      },
    ],
    datasets: { "answers-public": { commit: COMMIT, place: "public" } },
    instruments: {
      "quality-judge": {
        files: d("d4"),
        judge: {
          model: "provider/model-x@2026-10-01",
          parameters: { temperature: 0 },
          prompt: d("d5"),
          rubric: d("d6"),
          inputsDigest: d("d7"),
        },
      },
      "ts-scorers": { files: d("d8") },
    },
    measures: {
      searched: { definition: d("e2"), implementation: d("f2") },
      grounded: { definition: d("e3"), implementation: d("f2") },
      "cites-page": { definition: d("e4"), implementation: d("f4") },
      correct: { definition: d("e5"), implementation: d("f5") },
      "rank-ndcg": { definition: d("e6"), implementation: d("f2") },
      "latency-ms": { definition: d("e7"), implementation: d("f2") },
    },
    limits: {
      grounded: {
        limit: 0.05,
        owner: "answers-owner",
        reason: "Pass needs any drop to stay under 5 points.",
      },
    },
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
    // The outcomes are closed: a reader refuses an unknown one too.
    "unknown-outcome": (r) => (r["outcome"] = "partial"),
    "missing-configuration": (r) => delete r["configuration"],
    "negative-tokens": (r) => ((r["usage"] as Record<string, unknown>)["inputTokens"] = -1),
    "missing-data-class": (r) => delete r["dataClass"],
    "fractional-replicate": (r) => (r["replicate"] = 0.5),
  },
  trialRequest: {
    "attempt-zero": (r) => ((r["trial"] as Record<string, unknown>)["attempt"] = 0),
    "missing-case-digest": (r) => delete (r["case"] as Record<string, unknown>)["digest"],
    "missing-deadline": (r) => delete r["deadline"],
    "deadline-zero": (r) => (r["deadline"] = "PT0S"),
    "deadline-in-minutes": (r) => (r["deadline"] = "PT2M"),
    "deadline-as-number": (r) => (r["deadline"] = 120),
    "missing-workdir": (r) => delete r["workdir"],
    "missing-configuration-path": (r) => (r["configuration"] = {}),
    "traceparent-uppercase": (r) =>
      (r["trace"] = { traceparent: `00-${"4BF92F3577B34DA6".repeat(2)}-00f067aa0ba902b7-01` }),
    "replay-without-digest": (r) => (r["replay"] = { stage: "search", path: "/tmp/frozen" }),
    "seed-out-of-range": (r) =>
      (r["seed"] = { algorithm: "mt19937", value: "18446744073709551616" }),
  },
  trialResult: {
    "missing-usage": (r) => delete r["usage"],
    "negative-calls": (r) => ((r["usage"] as Record<string, unknown>)["calls"] = -1),
    "truncated-not-a-boolean": (r) => (r["truncated"] = "yes"),
    "event-without-ran": (r) => delete (r["events"] as Array<Record<string, unknown>>)[0]!["ran"],
    "event-negative-iteration": (r) =>
      ((r["events"] as Array<Record<string, unknown>>)[0]!["iteration"] = -1),
    "event-replayed-not-a-digest": (r) =>
      ((r["events"] as Array<Record<string, unknown>>)[0]!["replayed"] = "frozen-search"),
    "stop-without-reason": (r) => (r["stop"] = {}),
    "artifact-without-path": (r) => (r["artifacts"] = [{ name: "a", mediaType: "text/plain" }]),
    "artifact-media-type-not-a-type": (r) =>
      (r["artifacts"] = [{ name: "a", path: "/tmp/a", mediaType: "plain text" }]),
    "usage-without-response-ids": (r) =>
      delete (r["usage"] as Record<string, unknown>)["responseIds"],
    "usage-without-calls": (r) => delete (r["usage"] as Record<string, unknown>)["calls"],
    "usage-fractional-cost": (r) => ((r["usage"] as Record<string, unknown>)["costMicros"] = 1.5),
    "throttled-negative-wait": (r) =>
      ((r["usage"] as Record<string, unknown>)["throttled"] = { count: 1, ms: -5 }),
    "throttled-non-finite-wait": (r) =>
      ((r["usage"] as Record<string, unknown>)["throttled"] = {
        count: 0,
        ms: { nonFinite: "inf" },
      }),
    "observed-without-keys-read": (r) =>
      delete (r["observed"] as Record<string, unknown>)["configurationRead"],
    "observed-configuration-as-path": (r) =>
      ((r["observed"] as Record<string, unknown>)["configuration"] = "configs/answer-short.json"),
    "observed-without-environment": (r) =>
      delete (r["observed"] as Record<string, unknown>)["environment"],
    "trace-without-ids": (r) => (r["trace"] = { ids: [], complete: true }),
    "trace-id-too-short": (r) => (r["trace"] = { ids: ["4bf92f35"], complete: true }),
    "trace-without-complete": (r) => (r["trace"] = { ids: ["4bf92f3577b34da6a3ce929d0e0e4736"] }),
    "trace-spans-as-a-total": (r) =>
      (r["trace"] = { ids: ["4bf92f3577b34da6a3ce929d0e0e4736"], spans: 7, complete: true }),
    "trace-spans-keyed-by-a-name": (r) =>
      (r["trace"] = {
        ids: ["4bf92f3577b34da6a3ce929d0e0e4736"],
        spans: { answer: 7 },
        complete: true,
      }),
    "route-as-url": (r) =>
      ((r["observed"] as Record<string, unknown>)["route"] = "https://api.example.com/v1"),
    "short-commit": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = { commit: "0123456" }),
    "code-without-commit-or-image": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = {}),
    "image-with-short-commit": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = { image: d("b2"), commit: "abc" }),
  },
  workerError: {
    "missing-kind": (r) => delete r["kind"],
    "empty-kind": (r) => (r["kind"] = ""),
  },
  workerReady: {
    "capacity-zero": (r) => (r["capacity"] = 0),
    "fractional-capacity": (r) => (r["capacity"] = 1.5),
    "missing-protocol": (r) => delete r["protocol"],
    "missing-capacity": (r) => delete r["capacity"],
  },
  workerEvent: {
    "tool-call-without-name": (r) => {
      delete r["calls"];
      Object.assign(r, {
        dataClass: "none",
        kind: "tool_call",
        stage: "search",
        iteration: 0,
        call: { id: "call_01", args: {} },
      });
    },
    "tool-call-result-and-result-artifact": (r) => {
      delete r["calls"];
      Object.assign(r, {
        dataClass: "pseudonymous",
        kind: "tool_call",
        stage: "search",
        iteration: 0,
        call: {
          id: "call_03",
          name: "search_help_centre",
          args: {},
          result: { pages: [] },
          resultArtifact: "search-results",
        },
      });
    },
    "tool-call-result-artifact-empty": (r) => {
      delete r["calls"];
      Object.assign(r, {
        dataClass: "pseudonymous",
        kind: "tool_call",
        stage: "search",
        iteration: 0,
        call: { id: "call_03", name: "search_help_centre", args: {}, resultArtifact: "" },
      });
    },
    "tool-call-without-data-class": (r) => {
      delete r["calls"];
      Object.assign(r, {
        kind: "tool_call",
        stage: "search",
        iteration: 0,
        call: { id: "call_01", name: "search_help_centre", args: {} },
      });
    },
    "missing-calls": (r) => delete r["calls"],
    "negative-calls": (r) => (r["calls"] = -1),
    "missing-trial": (r) => delete r["trial"],
    "attempt-zero": (r) => ((r["trial"] as Record<string, unknown>)["attempt"] = 0),
    "throttled-without-count": (r) => (r["throttled"] = { ms: 1200 }),
  },
  cancel: {
    "missing-trial": (r) => delete r["trial"],
    "trial-as-id": (r) => (r["trial"] = "refund-window-de/a/r1"),
    "trial-and-request": (r) => (r["request"] = "score-0001"),
    "request-not-an-id": (r) => {
      delete r["trial"];
      r["request"] = "";
    },
  },
  scoreRequest: {
    "missing-id": (r) => delete r["id"],
    "id-with-a-space": (r) => (r["id"] = "score 0001"),
    "missing-deadline": (r) => delete r["deadline"],
    "missing-scratch": (r) => delete r["scratch"],
    "no-units": (r) => (r["units"] = []),
    "no-measures": (r) => (r["measures"] = []),
    "unit-without-trial": (r) => delete (r["units"] as Array<Record<string, unknown>>)[0]!["trial"],
    "artifact-without-path": (r) =>
      ((r["units"] as Array<Record<string, unknown>>)[0]!["artifacts"] = [{ name: "exercise" }]),
    "references-not-an-object": (r) =>
      ((r["case"] as Record<string, unknown>)["references"] = "30 days"),
    "deadline-in-minutes": (r) => (r["deadline"] = "PT2M"),
  },
  scoreResult: {
    "missing-request": (r) => delete r["request"],
    "no-values": (r) => (r["values"] = []),
    "ok-without-value": (r) => delete (r["values"] as Array<Record<string, unknown>>)[0]!["value"],
    // A level is reported by its value, as the measure lists its levels, never by a name.
    "level-by-name": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[0]!["value"] = "mostly-correct"),
    "non-finite-score": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[1]!["value"] = { nonFinite: "nan" }),
    "error-without-failure": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[0] = {
        trial: "t-1",
        measure: "correct",
        status: "error",
      }),
    "missing-without-reason": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[0] = {
        trial: "t-1",
        measure: "correct",
        status: "missing",
      }),
    "proportion-without-items": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[1]!["value"] = {
        numerator: 0,
        denominator: 0,
      }),
    "observed-without-response-ids": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[0]!["observed"] = {
        model: "example-judge-2026-10",
      }),
    "value-without-measure": (r) =>
      delete (r["values"] as Array<Record<string, unknown>>)[0]!["measure"],
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
  "suite.2": {
    "missing-about": (r) => delete r["about"],
    "about-without-threats": (r) => delete (r["about"] as Record<string, unknown>)["threats"],
    "missing-measures": (r) => delete r["measures"],
    "missing-budget": (r) => delete r["budget"],
    "cases-from-and-source": (r) =>
      ((r["cases"] as Record<string, unknown>)["source"] = { file: "cases.jsonl" }),
    "measure-as-function-source": (r) =>
      ((r["measures"] as Record<string, Record<string, unknown>>)["grounded"]!["scorer"] =
        "(output) => output.includes('http')"),
    "module-outside-instrument": (r) =>
      ((r["measures"] as Record<string, Record<string, Record<string, unknown>>>)["cites-page"]![
        "scorer"
      ]!["module"] = "../scorers/cites.ts"),
    "quantity-without-unit": (r) =>
      delete (r["measures"] as Record<string, Record<string, unknown>>)["latency-ms"]!["unit"],
    "limit-above-one": (r) =>
      ((r["policy"] as Record<string, Record<string, Record<string, unknown>>>)["primary"]![
        "grounded"
      ]!["limit"] = 5),
    "limit-of-zero": (r) =>
      ((r["policy"] as Record<string, Record<string, Record<string, unknown>>>)["primary"]![
        "grounded"
      ]!["limit"] = 0),
    "primary-without-owner": (r) =>
      delete (r["policy"] as Record<string, Record<string, Record<string, unknown>>>)["primary"]![
        "grounded"
      ]!["owner"],
    "duration-in-words": (r) => (r["limits"] = { trialDeadline: "2 minutes" }),
    "level-without-levels": (r) =>
      ((r["measures"] as Record<string, unknown>)["completeness"] = {
        type: "level",
        spacing: "equal",
      }),
    "judge-parameter-as-an-object": (r) =>
      ((
        (r["instruments"] as Record<string, Record<string, unknown>>)["quality-judge"]![
          "judge"
        ] as Record<string, unknown>
      )["parameters"] = { response: { type: "json" } }),
    "import-module-outside-the-tree": (r) => {
      delete r["worker"];
      r["import"] = { module: "../importers/bench.ts" };
    },
    "fidelity-margin-of-one": (r) => (r["attribute"] = { fidelityMargin: { grounded: 1 } }),
    "self-verdict-without-class": (r) =>
      ((r["stopReasons"] as Record<string, unknown>)["REPAIR_BUDGET_EXHAUSTED"] = {
        selfVerdict: true,
      }),
  },
  "configuration.2": {
    "missing-digest": (r) => delete r["digest"],
    "bad-digest": (r) => (r["digest"] = "sha256:abc"),
  },
  project: {
    "branch-for-commit": (r) =>
      ((r["datasets"] as Record<string, Record<string, Record<string, unknown>>>)[
        "answers-public"
      ]!["git"]!["commit"] = "main"),
    "https-with-query": (r) =>
      ((r["datasets"] as Record<string, unknown>)["answers-public"] = {
        https: { url: "https://example.com/cases.jsonl?sig=abc" },
        digest: d("a9"),
      }),
    "sentinel-below-five": (r) =>
      ((r["baselines"] as Record<string, unknown>)["sentinel"] = { share: 0.1, min: 4 }),
    "route-to-no-sink": (r) =>
      ((r["delivery"] as Record<string, Array<Record<string, unknown>>>)["routes"]![0]!["to"] = []),
    "webhook-without-signing-key": (r) =>
      ((r["delivery"] as Record<string, Record<string, unknown>>)["sinks"]!["hook"] = {
        kind: "webhook",
        url: { fromEnv: "HOOK_URL" },
      }),
    "token-in-a-command": (r) =>
      ((r["workers"] as Record<string, Record<string, unknown>>)["assistant"]!["command"] = [
        "worker",
        // The header form: refused by the header rule, and no provider's token format, so no
        // secret scanner flags the generated fixture.
        "Authorization: Bearer x0x0x0x0",
      ]),
    "repository-with-credentials": (r) =>
      ((r["datasets"] as Record<string, Record<string, Record<string, unknown>>>)[
        "answers-public"
      ]!["git"]!["repo"] = "https://x-access-token:ghp_abcdefghij0123456789@github.com/o/r.git"),
    "zero-capacity": (r) =>
      ((r["workers"] as Record<string, Record<string, unknown>>)["assistant"]!["capacity"] = 0),
  },
  "suite.lock": {
    "missing-measurement-digest": (r) => delete r["measurementDigest"],
    "https-origin-with-a-query": (r) =>
      ((r["sources"] as Array<Record<string, unknown>>)[0]!["origin"] = {
        https: { host: "example.com", path: "/cases.jsonl?sig=abc" },
      }),
    "negative-bytes": (r) => ((r["sources"] as Array<Record<string, unknown>>)[0]!["bytes"] = -1),
    "measure-without-implementation": (r) =>
      delete (r["measures"] as Record<string, Record<string, unknown>>)["searched"]![
        "implementation"
      ],
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
/** Removes what only a delivered result carries, for a result that reports a failure. */
const withoutDelivery = (r: Record<string, unknown>): void => {
  for (const member of ["output", "events", "stop", "timing"]) delete r[member];
};

export const VALID_EXTRA: Record<string, Record<string, Mutation>> = {
  plan: {
    // A plan with a bound per trial books its worst case as the trials of its arms with `runs`
    // times the bound, as decide checks: here one planned trial at 2 calls.
    "calls-per-trial": (r) => {
      (r["budget"] as Record<string, unknown>)["callsPerTrial"] = 2;
      (r["budget"] as Record<string, unknown>)["worstCaseCalls"] = 2;
      for (const arm of r["arms"] as Array<Record<string, unknown>>) arm["runs"] = true;
    },
    "one-arm-imported": (r) => {
      (r["budget"] as Record<string, unknown>)["callsPerTrial"] = 2;
      (r["budget"] as Record<string, unknown>)["worstCaseCalls"] = 2;
      const arms = r["arms"] as Array<Record<string, unknown>>;
      arms[arms.length - 1]!["runs"] = true;
    },
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
    "after-two-retries": (r) => {
      r["attempts"] = [
        { attempt: 1, failure: { class: "infrastructure", kind: "timeout" }, calls: 1 },
        { attempt: 2, failure: { class: "not_run", kind: "never-reached" }, calls: 0 },
      ];
    },
    "protocol-failure": (r) => {
      r["outcome"] = "protocol_failure";
      delete r["output"];
      r["error"] = { kind: "bad-request" };
    },
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
    "with-why": (r) => {
      r["value"] = { type: "binary", pass: false };
      r["why"] = "claims a test that is not in the diff";
    },
  },
  trialRequest: {
    // A stage suite that starts after `search`, with a simulated user and a trace context.
    "traced-replay": (r) => {
      r["trace"] = { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" };
      r["seed"] = { algorithm: "mt19937", value: "20261115" };
      r["replay"] = {
        stage: "search",
        path: "/tmp/ichnaea/run-2026-11-15-a/frozen/search",
        digest: d("a9"),
        state: { callsLeft: 4 },
      };
    },
  },
  trialResult: {
    "infrastructure-failure": (r) => {
      withoutDelivery(r);
      r["failure"] = {
        class: "infrastructure",
        kind: "rate-limited",
        message: "429 from the endpoint",
      };
      r["usage"] = { calls: 1, responseIds: ["resp_01"], throttled: { count: 3, ms: 9000 } };
    },
    "image-released-service": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = { image: d("b2") }),
    "commit-and-image": (r) =>
      ((r["observed"] as Record<string, unknown>)["code"] = {
        commit: "0123456789abcdef0123456789abcdef01234567",
        image: d("b2"),
      }),
    // Timing and the token counts are optional: absent means unknown, never zero.
    "only-the-calls": (r) => {
      r["usage"] = { calls: 3, responseIds: [] };
      delete r["timing"];
    },
    // The worker knows it cut the output: it is not captured, and never scored.
    truncated: (r) => (r["truncated"] = true),
    "with-cost-and-reasoning": (r) =>
      Object.assign(r["usage"] as Record<string, unknown>, {
        reasoningTokens: 210,
        costMicros: 1840,
        throttled: { count: 2, ms: 3100 },
      }),
    "output-behind-pointer": (r) => {
      delete r["output"];
      r["pointer"] = "trace://composer/8f2c";
    },
    // A malformed request is the harness's fault: class protocol, never a system failure.
    "bad-request": (r) => {
      withoutDelivery(r);
      r["failure"] = { class: "protocol", kind: "bad-request" };
      r["usage"] = { calls: 0, responseIds: [] };
    },
    "bad-request-before-settings": (r) => {
      withoutDelivery(r);
      r["failure"] = { class: "protocol", kind: "bad-request" };
      r["usage"] = { calls: 0, responseIds: [] };
      r["observed"] = { kind: "unavailable" };
    },
    "settings-and-context": (r) => {
      r["context"] = "process-instance-7";
      r["observed"] = { kind: "settings", configuration: d("c3") };
    },
    // A trial that delivers a directory instead of an inline output.
    "artifacts-only": (r) => {
      delete r["output"];
      r["artifacts"] = [
        {
          name: "exercise",
          path: "/tmp/ichnaea/run-2026-11-15-a/trial-0001/exercise",
          mediaType: "inode/directory",
        },
        {
          name: "transcript",
          path: "/tmp/ichnaea/run-2026-11-15-a/trial-0001/transcript.json",
          mediaType: "application/json",
          class: "pseudonymous",
        },
      ];
      (r["events"] as Array<Record<string, unknown>>)[1]!["artifact"] = "exercise";
    },
    // Two traces, one of which the SDK gave no count for.
    traced: (r) =>
      (r["trace"] = {
        ids: ["4bf92f3577b34da6a3ce929d0e0e4736", "0af7651916cd43dd8448eb211c80319c"],
        spans: { "4bf92f3577b34da6a3ce929d0e0e4736": 7 },
        complete: true,
      }),
    "replayed-stage": (r) => {
      const search = (r["events"] as Array<Record<string, unknown>>)[0]!;
      delete search["output"];
      search["replayed"] = d("a9");
    },
    "code-from-outside-the-arm": (r) =>
      ((r["observed"] as Record<string, unknown>)["modules"] = [
        "/work/support-assistant/lib/rag.py",
      ]),
    "stage-not-run": (r) =>
      (r["events"] = [
        { stage: "search", iteration: 0, ran: false },
        ...(r["events"] as unknown[]).slice(1),
      ]),
  },
  workerError: {
    "with-message": (r) => (r["message"] = "line 3 is not JSON: unexpected end of input"),
  },
  cancel: {
    // A scorer's request, by the `id` that the request carries.
    "score-request": (r) => {
      delete r["trial"];
      r["request"] = "score-0001";
    },
  },
  workerReady: {
    "one-at-a-time": (r) => (r["capacity"] = 1),
    scorer: (r) => (r["protocol"] = "ichnaea.scoreRequest/1"),
  },
  workerEvent: {
    "tool-call": (r) => {
      delete r["calls"];
      Object.assign(r, {
        // A tool call's content is at least pseudonymous unless its tool maps to a factor.
        dataClass: "pseudonymous",
        kind: "tool_call",
        stage: "search",
        iteration: 0,
        call: {
          id: "call_01",
          name: "search_help_centre",
          args: { query: "Rückgabe nach 40 Tagen", top: 3 },
          result: { pages: ["policy.md"] },
        },
      });
    },
    // A result too large to inline is an artifact of the trial, named here.
    "tool-call-large-result": (r) => {
      delete r["calls"];
      Object.assign(r, {
        dataClass: "pseudonymous",
        kind: "tool_call",
        stage: "search",
        iteration: 0,
        call: {
          id: "call_03",
          name: "search_help_centre",
          args: { query: "Rückgabe", top: 200 },
          resultArtifact: "search-results",
        },
      });
    },
    // Class none: the suite maps this tool to a declared environment factor of class none.
    "tool-call-error-in-a-turn": (r) => {
      delete r["calls"];
      Object.assign(r, {
        dataClass: "none",
        kind: "tool_call",
        stage: "search",
        iteration: 1,
        turn: 1,
        call: { id: "call_02", name: "search_help_centre", args: {}, error: "empty query" },
      });
    },
    // The shim reports each wait under the endpoint's budget in every heartbeat.
    "throttled-heartbeat": (r) =>
      (r["throttled"] = { count: 1, ms: 1200, firstAcceptedAt: "2026-11-15T10:01:01.300Z" }),
  },
  scoreRequest: {
    // A deterministic scorer has no settings, and a trial may deliver only its output.
    "without-settings-or-artifacts": (r) => {
      delete r["settings"];
      const unit = (r["units"] as Array<Record<string, unknown>>)[0]!;
      delete unit["artifacts"];
      delete unit["events"];
    },
  },
  scoreResult: {
    "judge-reply-unparsable": (r) =>
      (r["values"] = [
        {
          trial: "refund-window-de/b/r0",
          measure: "correct",
          status: "missing",
          reason: "JUDGE_REPLY_UNPARSABLE",
          observed: { model: "example-judge-2026-10", responseIds: ["resp_j3"] },
        },
      ]),
    // The request's unit identities parse but its body does not: each unit is echoed.
    "bad-request": (r) =>
      (r["values"] = ["correct", "complete"].map((measure) => ({
        trial: "refund-window-de/b/r0",
        measure,
        status: "error",
        failure: { class: "protocol", kind: "bad-request" },
      }))),
    "judge-endpoint-down": (r) =>
      (r["values"] = [
        {
          trial: "refund-window-de/b/r0",
          measure: "correct",
          status: "error",
          failure: {
            class: "infrastructure",
            kind: "timeout",
            message: "judge endpoint timed out",
          },
        },
      ]),
    "level-and-proportion": (r) => {
      const values = r["values"] as Array<Record<string, unknown>>;
      values[0]!["value"] = 3;
      values[1]!["value"] = { numerator: 3, denominator: 4 };
    },
    // A hanging test run inside the deadline is a measured failure, not an error.
    "tests-timed-out": (r) =>
      (r["values"] = [
        {
          trial: "refund-window-de/b/r0",
          measure: "tests-pass",
          status: "ok",
          value: false,
          why: "tests timed out",
        },
      ]),
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
  "suite.2": {
    "inline-worker-and-cases-from-a-source": (r) => {
      r["worker"] = {
        command: ["node", "worker.ts"],
        processes: 2,
        startTimeout: "PT5M",
      };
      r["cases"] = {
        source: {
          git: { repo: "https://github.com/example/cases", commit: COMMIT, path: "a.jsonl" },
        },
        exposure: "private",
        frame: { population: "questions in the help desk", drawnBy: "random", date: "2026-11-01" },
      };
    },
    "import-instead-of-a-worker": (r) => {
      delete r["worker"];
      r["import"] = { command: ["python", "-m", "bench.export"] };
    },
    "import-from-a-module": (r) => {
      delete r["worker"];
      r["import"] = { module: "importers/bench.ts" };
    },
    "self-verdict-reduction-and-limits": (r) => {
      (r["stopReasons"] as Record<string, unknown>)["REPAIR_BUDGET_EXHAUSTED"] = {
        class: "completed",
        selfVerdict: true,
      };
      (r["measures"] as Record<string, Record<string, unknown>>)["grounded"]!["reduce"] = {
        all: { k: 2 },
      };
      r["limits"] = { trialDeadline: "PT2M", missingMax: 0.2 };
      r["baselines"] = { freshness: "P3D" };
      r["configuration"] = { record: ["model", "temperature"] };
      r["attribute"] = { fidelityMargin: { grounded: 0.025 } };
      (r["measures"] as Record<string, unknown>)["completeness"] = {
        type: "level",
        levels: [0, 1, 2, 3],
        anchors: { "0": "misses the question", "3": "answers every part" },
        spacing: { cut: 2 },
        scorer: { instrument: "quality-judge", dimension: "completeness" },
      };
    },
  },
  project: {
    "governance-at-home": (r) => {
      r["privacy"] = {
        homeKey: { fromEnv: "ICHNAEA_HOME_KEY" },
        consent: "/srv/eval/consent.jsonl",
        governance: {
          home: { description: "evaluation job inside the deployment's cluster" },
          purposes: {
            "PU-3": { enabled: true, basis: "consent", record: "dpia/raters-2026.md" },
            "PU-7": { enabled: true, basis: "public-task", record: "ropa/eval-at-home.md" },
          },
          endpoints: {
            "eu-llm": { provider: "example", region: "eu", purposes: ["PU-3", "PU-7"] },
          },
          retention: { pseudonymous: "P180D", personal: "P30D", labels: { study: "P3Y" } },
        },
      };
      const sinks = (r["delivery"] as Record<string, Record<string, unknown>>)["sinks"]!;
      sinks["il3"] = { kind: "teams-workflow", url: { fromEnv: "IL3_TEAMS_WORKFLOW_URL" } };
      sinks["records"] = {
        kind: "webhook",
        url: { fromEnv: "RECORDS_WEBHOOK_URL" },
        signingKey: { fromEnv: "RECORDS_WEBHOOK_SIGNING_KEY" },
        clearance: {
          maxExposure: "private",
          purpose: "PU-6",
          reason: "the team's records service",
        },
      };
    },
    "datasets-from-https-and-a-command": (r) => {
      r["datasets"] = {
        presigned: { https: { fromEnv: "CASES_URL" }, digest: d("a8") },
        dvc: {
          command: ["dvc", "pull", "data/answers.dvc"],
          output: "data/answers",
          env: ["AWS_PROFILE"],
        },
      };
    },
  },
  "suite.lock": {
    "command-source-and-an-image": (r) => {
      r["sources"] = [
        {
          origin: { command: ["dvc", "pull"], output: "data/answers" },
          digest: d("d9"),
          bytes: 0,
          pools: {},
        },
      ];
      (r["instruments"] as Record<string, Record<string, unknown>>)["ts-scorers"] = {
        files: d("d8"),
        image: { reference: "ghcr.io/example/grader:1", digest: d("da") },
      };
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
    // `usage.calls` is the one count: a reader ignores a top-level count as an unknown member.
    "top-level-calls": (r) => (r["calls"] = 3),
    // The throttle wait has one home, usage.throttled.ms: a writer sends no timing wait, and a
    // reader ignores one.
    "timing-with-a-wait": (r) => ((r["timing"] as Record<string, unknown>)["waitedMs"] = 0),
    // The base derives a stage's status: a worker sends none, and a reader ignores one.
    "event-with-status": (r) =>
      ((r["events"] as Array<Record<string, unknown>>)[0]!["status"] = "ok"),
    // The base maps a stop reason to its class: a reader ignores a class that a worker sends.
    "stop-with-class": (r) => (r["stop"] = { reason: "end_turn", class: "completed" }),
    // Ichnaea hashes artifacts itself: a reader ignores a digest that a worker sends.
    "artifact-with-digest": (r) =>
      (r["artifacts"] = [{ name: "a", path: "/tmp/a", mediaType: "text/plain", digest: d("a1") }]),
  },
  workerReady: {
    // A later version may define another kind of request: a reader reads the line, and Ichnaea
    // refuses a process that reads a kind it does not know.
    "future-protocol": (r) => (r["protocol"] = "ichnaea.trialRequest/2"),
  },
  workerEvent: {
    // A later minor version may add a kind of event, with members of its own.
    // A later kind need not count calls: the count belongs to the heartbeat.
    "future-kind": (r) => {
      delete r["calls"];
      r["kind"] = "progress";
      r["share"] = 0.5;
    },
  },
  cancel: {
    // A worker needs no reason to stop a trial: a reader ignores one.
    "with-reason": (r) => (r["reason"] = "deadline"),
  },
  workerError: {
    // A worker never guesses which trial an unreadable line was for: a writer refuses a trial
    // identity, and a reader ignores one as an unknown member.
    "guessed-trial": (r) => (r["trial"] = structuredClone(VALID["trialResult"]!["trial"])),
  },
  scoreRequest: {
    // A worker never receives references; a scorer may get a member a later minor version adds.
    "future-unit-member": (r) =>
      ((r["units"] as Array<Record<string, unknown>>)[0]!["turns"] = [{ role: "user" }]),
  },
  scoreResult: {
    // A value on an entry that is not ok is an unknown member: a writer refuses it, and a reader
    // ignores it, because the status alone says that there is no value.
    "not-applicable-with-value": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[2]!["value"] = false),
    "missing-with-value": (r) =>
      ((r["values"] as Array<Record<string, unknown>>)[0] = {
        trial: "t-1",
        measure: "correct",
        status: "missing",
        reason: "X",
        value: 0,
      }),
    "future-status": (r) =>
      (r["values"] = [
        { trial: "refund-window-de/b/r0", measure: "correct", status: "deferred", until: "later" },
      ]),
    // A worker class does not apply to a scorer: a writer refuses it, a reader reports it.
    "worker-class-system": (r) =>
      (r["values"] = [
        {
          trial: "refund-window-de/b/r0",
          measure: "correct",
          status: "error",
          failure: { class: "system", kind: "crashed" },
        },
      ]),
    "future-error-class": (r) =>
      (r["values"] = [
        {
          trial: "refund-window-de/b/r0",
          measure: "correct",
          status: "error",
          failure: { class: "quota", kind: "judge-quota" },
        },
      ]),
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
  "suite.2": {
    "future-measure-type": (r) =>
      ((r["measures"] as Record<string, Record<string, unknown>>)["grounded"]!["type"] = "ranking"),
    "future-stop-class": (r) =>
      ((r["stopReasons"] as Record<string, unknown>)["COMPLETED"] = "partial"),
    "future-member": (r) => (r["traces"] = { store: "local" }),
  },
  "configuration.2": { "future-member": (r) => (r["label"] = "candidate") },
  project: {
    "future-sink-kind": (r) =>
      ((r["delivery"] as Record<string, Record<string, Record<string, unknown>>>)["sinks"]!["pr"]![
        "kind"
      ] = "email"),
  },
  "suite.lock": {
    "future-place": (r) =>
      ((r["datasets"] as Record<string, Record<string, unknown>>)["answers-public"]!["place"] =
        "internal"),
  },
};
