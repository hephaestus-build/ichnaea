// Writes the example's synthetic data: cases, case set, suite, two configurations and the result
// files of the application's runner for both. Deterministic. Usage: node scripts/generate.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalize, caseDigest, caseSetDigest } from "@tumaet/ichnaea/contracts";

const root = join(import.meta.dirname, "..");
const topics = [
  ["return window", "30 days"],
  ["refund method", "original payment method"],
  ["exchange fee", "free of charge"],
  ["warranty", "two years"],
  ["shipping time", "three working days"],
  ["opened items", "unused"],
  ["gift receipt", "store credit"],
  ["sale items", "final sale"],
  ["damaged parcel", "photo of the damage"],
  ["missing parts", "within 14 days"],
  ["international returns", "prepaid label"],
  ["price match", "seven days"],
] as const;

const cases = topics.map(([topic, fact], i) => ({
  schema: "ichnaea.case/1",
  id: `support-${String(i + 1).padStart(2, "0")}`,
  unit: "turn",
  dataClass: "none",
  input: { question: `What is the policy on ${topic}?` },
  references: { facts: [fact] },
  family: topic.replaceAll(" ", "-"),
  provenance: {
    source: "authored",
    selection: "curated",
    created: "2026-11-01",
    licence: "CC0-1.0",
    exposure: "public",
  },
  pool: "development",
}));
const entries = await Promise.all(
  cases.map(async (c) => ({
    id: c.id,
    digest: await caseDigest(c),
    pool: c.pool,
    family: c.family,
  })),
);
const caseSet = {
  schema: "ichnaea.caseSet/1",
  id: "support-answers",
  version: "1",
  digest: await caseSetDigest(entries),
  cases: entries,
};

const suite = {
  schema: "ichnaea.suite/1",
  id: "support-answers",
  version: "1",
  objective: "Answers about store policies stay correct when the assistant changes.",
  construct: "Factual correctness of answers against the policy pages.",
  decision: "Merge or hold a change to the assistant.",
  scope: "Questions about returns, refunds and shipping.",
  nonCoverage: "Tone, latency and other topics.",
  estimand: "fixed-cases",
  caseSet: { id: "support-answers", path: "data/cases.jsonl", digest: caseSet.digest },
  replicates: 3,
  primary: [
    {
      measure: "support/facts-stated",
      margin: 0.15,
      marginStatus: "registered",
      marginReason:
        "Twelve cases cannot see smaller drops; the floor at three replicates is about 0.08.",
    },
  ],
  hardGates: ["support/answers-present"],
  budget: { maxCalls: 200, callsPerTrial: 1 },
  policy: {
    onRegression: "block",
    onInconclusive: "report",
    onRunDrop: "block",
    onEstimateOnly: "report",
  },
  measureReviewDate: "2027-05-01",
};

const configuration = (model: string, prompt: string) => ({
  schema: "ichnaea.configuration/1",
  description: "Support assistant: one answer model over the policy pages.",
  models: [
    {
      role: "answer",
      provider: { value: "example-provider", status: "pinned" },
      id: { value: model, status: "pinned" },
    },
  ],
  parameters: [{ name: "answer.temperature", value: 0.2, status: "pinned", origin: "explicit" }],
  prompts: [
    { name: "answer", digest: `sha256:${prompt.repeat(64).slice(0, 64)}`, status: "pinned" },
  ],
  factors: {},
});

/** The application's runner: the candidate forgets the fact on three cases. */
const runs = (forget: ReadonlySet<number>) =>
  cases.flatMap((c, i) =>
    [0, 1, 2].map((replicate) => ({
      case: c.id,
      replicate,
      outcome: "completed",
      answer: forget.has(i) ? "Please check our help centre." : `Our policy: ${topics[i]?.[1]}.`,
    })),
  );

const write = (path: string, text: string): void => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
write("data/cases.jsonl", `${cases.map((c) => canonicalize(c)).join("\n")}\n`);
write("data/case-set.json", json(caseSet));
write("data/suite.json", json(suite));
write("configurations/base.json", json(configuration("example-model-2026-10", "a")));
write("configurations/candidate.json", json(configuration("example-model-2026-11", "b")));
write("results/base.json", json({ arm: "base", runs: runs(new Set()) }));
write("results/candidate-same.json", json({ arm: "candidate", runs: runs(new Set()) }));
write(
  "results/candidate-regressed.json",
  json({ arm: "candidate", runs: runs(new Set([2, 5, 8])) }),
);
console.log(`wrote ${cases.length} cases and their results`);
