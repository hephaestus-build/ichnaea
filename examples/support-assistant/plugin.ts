// The application's own plugin: one measure Ichnaea computes from the answer text, and an importer
// for the result files the application's existing runner writes.
import { readFile } from "node:fs/promises";

import { Case, type MeasureValue, Trial } from "@hephaestus-build/ichnaea/contracts";
import {
  defineMeasure,
  definePlugin,
  type Importer,
  NOT_CAPTURED,
} from "@hephaestus-build/ichnaea";

const facts = (c: Case): string[] => (c.references?.["facts"] as string[] | undefined) ?? [];

const goodCase = Case.parse({
  schema: "ichnaea.case/1",
  id: "example",
  unit: "turn",
  dataClass: "none",
  input: { question: "How long is the return window?" },
  references: { facts: ["30 days"] },
  provenance: {
    source: "authored",
    selection: "curated",
    created: "2026-11-01",
    licence: "CC0-1.0",
    exposure: "public",
  },
  pool: "development",
});
const answer = (text: string): Trial =>
  Trial.parse({
    schema: "ichnaea.trial/1",
    id: "example",
    source: "offline",
    case: "example",
    unit: "turn",
    configuration: `sha256:${"0".repeat(64)}`,
    replicate: 0,
    outcome: "completed",
    dataClass: "none",
    output: { text },
  });

/** The answer states every gold fact of the case. */
export const factsStated = defineMeasure({
  card: {
    id: "support/facts-stated",
    version: "1.0.0",
    construct: "The answer states every gold fact of the case.",
    operationalDefinition:
      "1 if every gold fact appears in the answer text (case-insensitive), else 0.",
    valueType: "binary",
    unit: "proportion",
    direction: "higher",
    justification: "Wrong return rules cost money and trust.",
    errorModel: "A paraphrase of a fact is missed.",
    applicability: "Cases with at least one gold fact.",
    tier: "primary",
    unitOfEvaluation: "turn",
    establishes: "Literal agreement with the gold facts, not helpfulness.",
    computedBy: "ichnaea",
  },
  appliesTo: (c) => facts(c).length > 0,
  score: (trial, c) => {
    const text = String((trial.output as { text?: string } | undefined)?.text ?? "").toLowerCase();
    return { type: "binary", pass: facts(c).every((f) => text.includes(f.toLowerCase())) };
  },
  examples: {
    good: [
      {
        name: "states the window",
        case: goodCase,
        trial: answer("You can return it within 30 days."),
        expected: { type: "binary", pass: true },
      },
    ],
    bad: [
      {
        name: "wrong window",
        case: goodCase,
        trial: answer("You can return it within 14 days."),
        expected: { type: "binary", pass: false },
      },
    ],
  },
});

interface ResultFile {
  readonly arm: string;
  readonly runs: ReadonlyArray<{
    case: string;
    replicate: number;
    outcome: Trial["outcome"];
    answer?: string;
    /** When the runner started and ended the call, if it records it. */
    startedAt?: string;
    endedAt?: string;
  }>;
}

const results: Importer<"support/results"> = {
  id: "support/results",
  version: "1.0.0",
  description: "The application's runner output: one answer per case and replicate.",
  async run({ files, options }) {
    const arms = options["arms"] as ReadonlyArray<{ name: string; identity: string }>;
    const trials: Trial[] = [];
    for (const file of files) {
      const parsed = JSON.parse(await readFile(file, "utf8")) as ResultFile;
      const identity = arms.find((a) => a.name === parsed.arm)?.identity;
      if (!identity) throw new Error(`${file}: arm '${parsed.arm}' is not in the plan`);
      for (const r of parsed.runs) {
        // The runner says "completed" when the call returned, but a record without an answer lost
        // its output on the way: that is a capture failure, which counts as missing, never as a
        // wrong answer. An empty answer was captured, so it stays completed and is scored.
        const lost = r.outcome === "completed" && r.answer === undefined;
        trials.push(
          Trial.parse({
            schema: "ichnaea.trial/1",
            id: `${r.case}/${parsed.arm}/r${r.replicate}`,
            source: "offline",
            run: options["run"] as string,
            case: r.case,
            unit: "turn",
            configuration: identity,
            arm: parsed.arm,
            replicate: r.replicate,
            outcome: lost ? "infrastructure_failure" : r.outcome,
            dataClass: "none",
            ...(r.answer === undefined ? {} : { output: { text: r.answer } }),
            ...(r.startedAt === undefined ? {} : { startedAt: r.startedAt }),
            ...(r.endedAt === undefined ? {} : { endedAt: r.endedAt }),
            ...(lost
              ? { error: { kind: NOT_CAPTURED, message: "the result file has no answer" } }
              : {}),
          }),
        );
      }
    }
    // The answers-present gate has a check, so Ichnaea computes it from these trials.
    return { trials, values: [] as MeasureValue[] };
  },
};

export const support = definePlugin({
  id: "support",
  version: "1.0.0",
  stability: "stable",
  measures: [factsStated],
  importers: [results],
  gates: [
    {
      id: "support/answers-present",
      version: "2.0.0",
      // A gate checks only output that was captured. A lost capture is missing data, which the
      // decision reports as coverage, never a failed check.
      description: "Every captured answer has text.",
      check: ({ trials }) => {
        const failures = trials.filter(
          (t) =>
            t.outcome === "completed" &&
            String((t.output as { text?: unknown } | undefined)?.text ?? "").trim() === "",
        ).length;
        return { passed: failures === 0, failures };
      },
    },
  ],
});
