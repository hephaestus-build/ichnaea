// A small synthetic suite for the library API's tests: six cases, two binary measures that read
// the raw output, and two trials per case and arm.
import { type Configuration, sha256 } from "../../../src/contracts/index.ts";
import {
  binary,
  defineSuite,
  type SuiteCase,
  type SuiteDefinition,
} from "../../../src/core/index.ts";

/** The output the synthetic system returns. */
export interface Output {
  readonly text: string;
  readonly declined: boolean;
}

const isOutput = (o: unknown): o is Output =>
  typeof o === "object" && o !== null && typeof (o as Output).text === "string";

/** A case that expects the system to raise or to decline. */
export const caseOf = (id: string, expected: "raise" | "decline"): SuiteCase => ({
  schema: "ichnaea.case/1",
  id,
  unit: "turn",
  dataClass: "none",
  input: { question: `question ${id}` },
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

export const CASES: readonly SuiteCase[] = [
  caseOf("c1", "raise"),
  caseOf("c2", "raise"),
  caseOf("c3", "raise"),
  caseOf("c4", "decline"),
  caseOf("c5", "decline"),
  caseOf("c6", "decline"),
];

const raise = caseOf("example-raise", "raise");
const decline = caseOf("example-decline", "decline");

export const answered = binary({
  score: (o) => (isOutput(o) ? o.text.length > 0 : undefined),
  examples: {
    good: [
      { name: "answers", case: raise, output: { text: "yes", declined: false }, expected: true },
    ],
    bad: [{ name: "empty", case: raise, output: { text: "", declined: false }, expected: false }],
  },
});

export const declines = binary({
  score: (o) => (isOutput(o) ? o.declined : undefined),
  appliesTo: (c) => c.slices?.["expected"] === "decline",
  examples: {
    good: [
      { name: "declines", case: decline, output: { text: "", declined: true }, expected: true },
      {
        name: "not a decline case",
        case: raise,
        output: { text: "x", declined: false },
        expected: "not-applicable",
      },
    ],
    bad: [
      { name: "speaks", case: decline, output: { text: "x", declined: false }, expected: false },
    ],
  },
});

/** The suite's definition, before defineSuite checks it. */
export const DEFINITION = {
  id: "composer",
  version: "1",
  card: {
    objective: "Composed reviews stay correct when the composer changes.",
    decision: "Merge or hold a change to the composer.",
    construct: "Whether the composer answers, and declines when it should.",
    scope: "Six synthetic questions.",
    nonCoverage: "Tone and latency.",
    threats: ["Six cases see only large drops."],
  },
  cases: CASES,
  measures: { answered, declines },
  policy: {
    primary: {
      answered: { margin: 0.2, reason: "Six cases see only large drops." },
      declines: { margin: 0.2, reason: "Six cases see only large drops." },
    },
    onRegression: "block",
    onInconclusive: "report",
    onEstimateOnly: "report",
  },
  trials: { default: 2 },
  budget: { calls: 100, callsPerTrial: 1 },
  configuration: () => configuration("base", 0.2),
  changes: () => ["/prompts/composer"],
} as const satisfies SuiteDefinition<"answered" | "declines">;

export const SUITE = defineSuite(DEFINITION);

/** A configuration with one model, one temperature and one prompt, whose text is `prompt`. */
export function configuration(prompt: string, temperature: number): Configuration {
  return {
    schema: "ichnaea.configuration/1",
    description: "The synthetic composer.",
    models: [
      {
        role: "composer",
        provider: { value: "example", status: "pinned" },
        id: { value: "example-model", status: "pinned" },
      },
    ],
    parameters: [{ name: "temperature", value: temperature, status: "pinned", origin: "explicit" }],
    prompts: [{ name: "composer", digest: sha256(prompt), status: "pinned" }],
    factors: {},
  };
}
