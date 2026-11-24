// A measure's identity has two parts: the digest of its definition in the suite, and the digest of
// the code that computes its values. Both enter the lock's measures entries
// and the key of a stored score, and the lock goes stale when either part changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Digest,
  instrumentImplementation,
  measureDefinitionDigest,
  ScoreKey,
  staleLockEntries,
  SuiteLock,
} from "../../src/contracts/index.ts";

type Rec = Record<string, unknown>;
const fixture = (name: string): Rec =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "fixtures", "valid", `${name}.json`),
      "utf8",
    ),
  ) as Rec;
const lock = (): SuiteLock => SuiteLock.parse(fixture("suite.lock"));
const d = (n: string): Digest => `sha256:${n.padStart(64, "0")}` as Digest;

describe("the definition digest", () => {
  it("is the digest of the measure's definition in the suite", () => {
    const m = { type: "binary", scorer: { builtin: "exact" } };
    expect(measureDefinitionDigest(m)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(measureDefinitionDigest(structuredClone(m))).toBe(measureDefinitionDigest(m));
  });

  it("changes with the definition's wording, such as a level's anchor", () => {
    const level = { type: "level", levels: [1, 2, 3], anchors: { "1": "poor", "3": "good" } };
    const reworded = { ...level, anchors: { "1": "weak", "3": "good" } };
    expect(measureDefinitionDigest(reworded)).not.toBe(measureDefinitionDigest(level));
  });

  it("refuses a value that is not a measure definition", () => {
    expect(() => measureDefinitionDigest({ type: "fraction" })).toThrow();
  });
});

describe("the implementation digest of an instrument process", () => {
  it("is the digest of the instrument's pin, so any pinned part changes it", () => {
    const pin = lock().instruments["quality-judge"];
    const other = structuredClone(pin) as Rec;
    (other["judge"] as Rec)["model"] = "provider/model-x@2026-11-01";
    expect(instrumentImplementation(pin)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(instrumentImplementation(other)).not.toBe(instrumentImplementation(pin));
  });
});

describe("the lock", () => {
  it("holds each measure's definition and implementation", () => {
    const l = lock();
    expect(Object.values(l.measures).length).toBeGreaterThan(0);
    for (const identity of Object.values(l.measures))
      expect(Object.keys(identity).toSorted()).toEqual(["definition", "implementation"]);
    const bare = { ...fixture("suite.lock"), measures: { searched: d("e2") } };
    expect(SuiteLock.safeParse(bare).success).toBe(false);
  });

  it("is current when nothing it pins differs", () => {
    expect(staleLockEntries(lock(), lock())).toEqual([]);
  });

  it("goes stale on a measure's implementation alone, naming the entry", () => {
    const current = lock();
    const id = Object.keys(current.measures)[0]!;
    current.measures[id] = { ...current.measures[id]!, implementation: d("abc") };
    expect(staleLockEntries(lock(), current)).toEqual([`/measures/${id}/implementation`]);
  });

  it("goes stale on a measure's definition, a new or a removed measure", () => {
    const current = lock();
    const [first, second] = Object.keys(current.measures);
    current.measures[first!] = { ...current.measures[first!]!, definition: d("abd") };
    delete current.measures[second!];
    current.measures["new-measure"] = { definition: d("1"), implementation: d("2") };
    expect(staleLockEntries(lock(), current).toSorted()).toEqual(
      [`/measures/${first}/definition`, `/measures/${second}`, "/measures/new-measure"].toSorted(),
    );
  });

  it("goes stale on the measurement digest, a source, a dataset, an instrument pin or a limit", () => {
    const current = lock();
    current.measurementDigest = d("abe");
    current.sources[0] = { ...current.sources[0]!, digest: d("abf") };
    current.instruments["ts-scorers"] = { files: d("ac0") };
    current.datasets = { ...current.datasets, "answers-public": { place: "private" } };
    current.limits["grounded"] = { ...current.limits["grounded"]!, limit: 0.04 };
    expect(staleLockEntries(lock(), current).toSorted()).toEqual(
      [
        "/measurementDigest",
        "/sources/0",
        "/instruments/ts-scorers",
        "/datasets/answers-public",
        "/limits/grounded",
      ].toSorted(),
    );
  });

  it("stays current when only the suite's digest differs", () => {
    const current = lock();
    current.suiteDigest = d("ac1");
    expect(staleLockEntries(lock(), current)).toEqual([]);
  });
});

describe("the key of a stored score", () => {
  it("is the scored result, the case and both parts of the measure's identity", () => {
    const key = {
      result: d("a"),
      case: d("d"),
      measure: { definition: d("b"), implementation: d("c") },
    };
    expect(ScoreKey.parse(key)).toEqual(key);
    expect(ScoreKey.safeParse({ ...key, measure: { definition: d("b") } }).success).toBe(false);
  });

  it("holds the case, so a corrected reference with the same result scores again", () => {
    const { case: _, ...withoutCase } = {
      result: d("a"),
      case: d("d"),
      measure: { definition: d("b"), implementation: d("c") },
    };
    expect(ScoreKey.safeParse(withoutCase).success).toBe(false);
  });
});
