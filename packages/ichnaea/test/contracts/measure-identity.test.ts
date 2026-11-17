// A measure's identity has two parts: the digest of its definition in the suite, and the digest of
// the code that computes its values. Both enter the measurement digest, the lock's measures entries
// and the key of a stored score, and the lock goes stale when either part changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Digest,
  IdentityError,
  instrumentImplementation,
  MEASUREMENT_RULE,
  measureDefinitionDigest,
  type MeasureIdentity,
  measurementDigest,
  ScoreKey,
  staleLockEntries,
  SuiteLock,
  SuiteV2,
} from "../../src/contracts/index.ts";

type Rec = Record<string, unknown>;
const fixture = (name: string): Rec =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "fixtures", "valid", `${name}.json`),
      "utf8",
    ),
  ) as Rec;
const suite = (): Rec => structuredClone(fixture("suite.2"));
const lock = (): SuiteLock => SuiteLock.parse(fixture("suite.lock"));
const d = (n: string): Digest => `sha256:${n.padStart(64, "0")}` as Digest;

/**
 * One identity for every measure of the fixture suite. A measure that reads an instrument's
 * dimension takes the digest of that instrument's pin; any other takes `implementation(id)`.
 */
function identities(s: Rec, implementation: (id: string) => Digest = () => d("1")) {
  const measures = s["measures"] as Record<string, Rec>;
  const instruments = lock().instruments;
  return Object.fromEntries(
    Object.entries(measures).map(([id, m]): [string, MeasureIdentity] => {
      const scorer = m["scorer"] as Rec | undefined;
      const pin =
        scorer !== undefined && "dimension" in scorer
          ? instruments[scorer["instrument"] as string]
          : undefined;
      return [
        id,
        {
          definition: measureDefinitionDigest(m),
          implementation: pin === undefined ? implementation(id) : instrumentImplementation(pin),
        },
      ];
    }),
  );
}

const pins = (s: Rec, implementation?: (id: string) => Digest) => {
  const l = lock();
  return {
    sources: l.sources,
    instruments: l.instruments,
    measures: identities(s, implementation),
  };
};

describe("the definition digest", () => {
  it("is the digest of the measure's definition in the suite", () => {
    const m = (suite()["measures"] as Rec)["cites-page"];
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

describe("the measurement digest", () => {
  it("changes with a measure's implementation, the definition unchanged", () => {
    const s = suite();
    const before = measurementDigest(s, pins(s));
    const after = measurementDigest(
      s,
      pins(s, (id) => (id === "cites-page" ? d("2") : d("1"))),
    );
    expect(after).not.toBe(before);
  });

  it("changes with a measure's definition", () => {
    const s = suite();
    const before = measurementDigest(s, pins(s));
    ((s["measures"] as Rec)["searched"] as Rec)["status"] = "failed";
    expect(measurementDigest(s, pins(s))).not.toBe(before);
  });

  it("refuses identities that do not name exactly the suite's measures", () => {
    const s = suite();
    const p = pins(s);
    const { searched: _, ...fewer } = p.measures;
    expect(() => measurementDigest(s, { ...p, measures: fewer })).toThrow(IdentityError);
    expect(() =>
      measurementDigest(s, { ...p, measures: { ...p.measures, extra: p.measures["searched"]! } }),
    ).toThrow(IdentityError);
  });

  it("refuses pins that do not name exactly the suite's instruments", () => {
    const s = suite();
    const p = pins(s);
    const { "ts-scorers": _, ...fewer } = p.instruments;
    expect(() => measurementDigest(s, { ...p, instruments: fewer })).toThrow(IdentityError);
    const more = { ...p.instruments, extra: { files: d("5") } };
    expect(() => measurementDigest(s, { ...p, instruments: more })).toThrow(IdentityError);
  });

  it("refuses an instrument measure whose implementation is not its instrument's pin", () => {
    const s = suite();
    const p = pins(s);
    const measures = {
      ...p.measures,
      correct: { ...p.measures["correct"]!, implementation: d("6") },
    };
    expect(() => measurementDigest(s, { ...p, measures })).toThrow(IdentityError);
  });

  it("refuses an identity whose definition is not the suite's", () => {
    const s = suite();
    const p = pins(s);
    const measures = { ...p.measures, searched: { definition: d("9"), implementation: d("1") } };
    expect(() => measurementDigest(s, { ...p, measures })).toThrow(IdentityError);
  });

  it("lists every member of a suite, hashed or left out with its reason", () => {
    const members = Object.keys(SuiteV2.shape).toSorted();
    const listed = [...MEASUREMENT_RULE.members, ...Object.keys(MEASUREMENT_RULE.excluded)];
    expect(listed.toSorted()).toEqual(members);
    for (const reason of Object.values(MEASUREMENT_RULE.excluded))
      expect(reason.length).toBeGreaterThan(10);
  });

  it.each([
    ["about", (s: Rec) => ((s["about"] as Rec)["objective"] = "Something else.")],
    ["version", (s: Rec) => (s["version"] = "5")],
    [
      "an owner",
      (s: Rec) =>
        ((((s["policy"] as Rec)["primary"] as Rec)["grounded"] as Rec)["owner"] = "someone-else"),
    ],
    ["the budget", (s: Rec) => ((s["budget"] as Rec)["calls"] = 1)],
  ])("leaves out %s", (_, change) => {
    const s = suite();
    const before = measurementDigest(s, pins(s));
    change(s);
    expect(SuiteV2.safeParse(s).success).toBe(true);
    expect(measurementDigest(s, pins(s))).toBe(before);
  });

  it.each([
    ["the stages", (s: Rec) => (s["stages"] = ["search", "answer"])],
    ["the stop reasons", (s: Rec) => ((s["stopReasons"] as Rec)["COMPLETED"] = "system")],
    ["the profiles", (s: Rec) => (((s["profiles"] as Rec)["try"] as Rec)["trials"] = 2)],
    ["the run limits", (s: Rec) => (s["limits"] = { missingMax: 0.1 })],
    [
      "the instruments",
      (s: Rec) => ((s["instruments"] as Rec)["ts-scorers"] = { files: ["x/**"] }),
    ],
  ])("covers %s", (_, change) => {
    const s = suite();
    const before = measurementDigest(s, pins(s));
    change(s);
    expect(SuiteV2.safeParse(s).success).toBe(true);
    expect(measurementDigest(s, pins(s))).not.toBe(before);
  });

  it("covers the pinned sources and instruments", () => {
    const s = suite();
    const p = pins(s);
    const before = measurementDigest(s, p);
    const sources = [{ ...p.sources[0]!, digest: d("77") }];
    expect(measurementDigest(s, { ...p, sources })).not.toBe(before);
    const instruments = { ...p.instruments, "ts-scorers": { files: d("78") } };
    expect(measurementDigest(s, { ...p, instruments })).not.toBe(before);
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
