// The library API end to end, as a consumer writes it: a suite with two binary measures over six
// cases at two trials per case and arm, rows for a base and a candidate, and the four calls
// createPlan, importResults, compare and report. A noise check plans and compares the same way.
import { describe, expect, it } from "vitest";

import type { Configuration } from "../../src/contracts/index.ts";
import { sha256, TrialResult } from "../../src/contracts/index.ts";
import {
  binary,
  defineSuite,
  importResults,
  type TimedResult,
  type SuiteCase,
} from "../../src/core/index.ts";
import { compare, createPlan } from "../../src/decide/index.ts";
import { report } from "../../src/report/index.ts";

interface Output {
  readonly text: string;
  readonly declined: boolean;
}
const isOutput = (o: unknown): o is Output =>
  typeof o === "object" && o !== null && typeof (o as Output).text === "string";

const question = (id: string, expected: "raise" | "decline"): SuiteCase => ({
  schema: "ichnaea.case/1",
  id,
  unit: "turn",
  dataClass: "none",
  input: { question: id },
  slices: { expected },
  provenance: {
    source: "authored",
    selection: "curated",
    created: "2026-11-01",
    licence: "CC0-1.0",
    exposure: "public",
  },
  pool: "development",
});
const raise = question("example-raise", "raise");
const decline = question("example-decline", "decline");

const suite = defineSuite({
  id: "reviews",
  version: "1",
  card: {
    objective: "Reviews stay useful when the composer changes.",
    decision: "Merge or hold a change to the composer.",
    construct: "Whether a review answers, and declines feedback when it should.",
    scope: "Six questions, three of which should be declined.",
    nonCoverage: "Tone, latency and cost.",
    threats: ["Six cases detect only large drops."],
  },
  cases: [
    question("q1", "raise"),
    question("q2", "raise"),
    question("q3", "raise"),
    question("q4", "decline"),
    question("q5", "decline"),
    question("q6", "decline"),
  ],
  measures: {
    answers: binary({
      score: (o) => (isOutput(o) ? o.text !== "" : undefined),
      examples: {
        good: [
          { name: "answers", case: raise, output: { text: "ok", declined: false }, expected: true },
        ],
        bad: [
          { name: "silent", case: raise, output: { text: "", declined: false }, expected: false },
        ],
      },
    }),
    declines: binary({
      score: (o) => (isOutput(o) ? o.declined : undefined),
      appliesTo: (c) => c.slices?.["expected"] === "decline",
      examples: {
        good: [
          {
            name: "declines",
            case: decline,
            output: { text: "ok", declined: true },
            expected: true,
          },
        ],
        bad: [
          {
            name: "speaks",
            case: decline,
            output: { text: "ok", declined: false },
            expected: false,
          },
        ],
      },
    }),
  },
  policy: {
    primary: {
      answers: {
        margin: 0.3,
        owner: "review maintainer",
        reason: "Six cases at two trials see only drops above 0.23.",
      },
      declines: {
        margin: 0.3,
        owner: "review maintainer",
        reason: "Six cases at two trials see only drops above 0.23.",
      },
    },
    onRegression: "block",
    onInconclusive: "report",
    onEstimateOnly: "report",
  },
  trials: { default: 2 },
  budget: { calls: 48, callsPerTrial: 1 },
  configuration: () => composer("Be brief."),
  changes: (paths) => (paths.some((p) => p.endsWith(".prompt")) ? ["/prompts/compose"] : []),
});

function composer(prompt: string): Configuration {
  return {
    schema: "ichnaea.configuration/1",
    description: "The review composer.",
    models: [
      {
        role: "compose",
        provider: { value: "example", status: "pinned" },
        id: { value: "example-model", status: "pinned" },
      },
    ],
    parameters: [{ name: "temperature", value: 0, status: "pinned", origin: "explicit" }],
    prompts: [{ name: "compose", digest: sha256(prompt), status: "pinned" }],
    factors: {},
  };
}

/**
 * What a worker would answer, with the times an importer knows: each arm declines, and answers as
 * `answers` says. This is a consumer's mapper: it writes `ichnaea.trialResult/1` records.
 */
function rowsFor(
  plan: ReturnType<typeof createPlan<typeof suite>>,
  answers: (arm: string) => boolean,
): TimedResult[] {
  return plan.record.trials.map((t, i) => ({
    result: TrialResult.parse({
      schema: "ichnaea.trialResult/1",
      dataClass: "none",
      trial: {
        id: t.id,
        suite: suite.id,
        case: t.case,
        arm: t.arm,
        replicate: t.replicate,
        attempt: 1,
      },
      output: { text: answers(t.arm) ? "a review" : "", declined: true },
      calls: 1,
      observed: {
        code: { commit: "c".repeat(40) },
        model: "example-model",
        route: sha256("https://models.example/v1"),
        parameters: { temperature: 0 },
      },
    }),
    startedAt: new Date(Date.UTC(2026, 10, 16, 12, 0, i)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 10, 16, 12, 0, i, 500)).toISOString(),
  }));
}

const base = composer("Be brief.");
const candidate = composer("Be brief, and always say something.");
const decidedAt = "2026-11-16T13:00:00Z";

describe("the library API, end to end", () => {
  it("gives REGRESSION when the candidate stops answering, and reports it", () => {
    const plan = createPlan(suite, {
      run: "pr-1",
      base,
      candidate,
      intendedChanges: suite.changes(["prompts/compose.prompt"]),
      createdAt: "2026-11-16T12:00:00Z",
    });
    expect(plan.record.mode).toBe("decision");
    expect(plan.record.trials).toHaveLength(6 * 2 * 2);
    const { records, summary } = importResults(
      plan,
      rowsFor(plan, (arm) => arm === "base"),
    );
    expect(summary).toMatchObject({ rows: 24, trials: 24, warnings: [], unused: [] });

    const decision = compare(plan, records, { decidedAt });
    expect(decision.verdict).toBe("REGRESSION");
    expect(decision.measures.map((m) => [m.measure, m.verdict])).toEqual([
      ["reviews/answers", "REGRESSION"],
      ["reviews/declines", expect.not.stringMatching(/REGRESSION/)],
    ]);

    const markdown = report(decision, {
      format: "markdown",
      suite: suite.id,
      lineage: records.run.lineage,
    });
    expect(markdown).toContain("Ichnaea decision: reviews");
    expect(markdown).toContain("REGRESSION");
    expect(markdown).toContain("reviews/answers");
    expect(markdown).toContain("Lineage");
  });

  it("plans and compares a noise check: the base against itself", () => {
    const plan = createPlan(suite, {
      run: "noise-1",
      base,
      candidate: base,
      createdAt: "2026-11-16T12:00:00Z",
    });
    expect(plan.record.arms[0]?.identity).toBe(plan.record.arms[1]?.identity);
    const decision = compare(
      plan,
      importResults(
        plan,
        rowsFor(plan, () => true),
      ).records,
      {
        decidedAt,
      },
    );
    expect(decision.verdict).not.toBe("INVALID");
    expect(decision.verdict).not.toBe("REGRESSION");
    expect(decision.invalidReasons).toEqual([]);
    expect(report(decision, { format: "markdown", suite: suite.id })).toContain(
      decision.verdict ?? "ESTIMATE-ONLY",
    );
  });
});
