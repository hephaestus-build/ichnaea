// REQ-135 (and the contract half of REQ-126): unknown, unclassified and off-schema values never
// pass an egress; personal and content fields pass only within the destination's class and
// purpose. The planter walks the normative JSON Schema, not the zod schema the projection uses.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type DataClass,
  DATA_CLASSES,
  DATA_POLICY_KEY,
  Label,
  MeasureValue,
  Monitor,
  projectForEgress,
  RECORD_CONTRACTS,
  Trial,
  Calibration,
  Configuration,
} from "../src/index.ts";
import { committedSchema } from "./support/ajv.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

type JsonSchema = Record<string, unknown>;
const MARK = "__ichnaea_planted__";
const containsMark = (value: unknown): boolean => JSON.stringify(value ?? null).includes(MARK);

/** Matches a value to the JSON Schema branch it validates against, structurally. */
function branchFor(node: JsonSchema, value: unknown): JsonSchema | undefined {
  const options = (node["anyOf"] ?? node["oneOf"]) as JsonSchema[] | undefined;
  if (!options) return node;
  return options.find((o) => {
    if (o["type"] === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const props = (o["properties"] ?? {}) as Record<string, JsonSchema>;
      return Object.entries(props).every(
        ([k, p]) => !("const" in p) || (value as Record<string, unknown>)[k] === p["const"],
      );
    }
    if (o["type"] === "array") return Array.isArray(value);
    if (o["type"] === "null") return value === null;
    return typeof value === (o["type"] === "integer" ? "number" : o["type"]);
  });
}

/**
 * Plants an unknown member into every object the JSON Schema defines, and, at a chosen leaf,
 * replaces the value by an off-schema object that carries the mark.
 */
function plant(node: JsonSchema, value: unknown, corrupt: () => boolean): unknown {
  const branch = branchFor(node, value) ?? node;
  if (branch["$ref"]) return value; // opaque JSON content: its members are content, not schema fields
  if (branch["type"] === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const props = (branch["properties"] ?? {}) as Record<string, JsonSchema>;
    const extra = branch["additionalProperties"] as JsonSchema | undefined;
    // Only closed shapes get a planted member: a record (open keys) holds content keys by design.
    const out: Record<string, unknown> = extra && typeof extra === "object" ? {} : { [MARK]: "x" };
    for (const [k, v] of Object.entries(value)) {
      const child =
        (Object.hasOwn(props, k) ? props[k] : undefined) ??
        (extra && typeof extra === "object" ? extra : undefined);
      out[k] = child ? plant(child, v, corrupt) : v;
    }
    return out;
  }
  if (branch["type"] === "array" && Array.isArray(value))
    return value.map((v) => plant(branch["items"] as JsonSchema, v, corrupt));
  return corrupt() ? { [MARK]: "off-schema", email: "alice@example.com" } : value;
}

/** Asserts that every value in an egress output has an effective class of `none`. */
function assertOnlyNone(node: JsonSchema, v: unknown, recordClass: string): void {
  if (v === undefined) return;
  const policy = node[DATA_POLICY_KEY] as { class: string } | undefined;
  if (policy) expect(policy.class === "inherit" ? recordClass : policy.class).toBe("none");
  const branch = branchFor(node, v) ?? node;
  if (branch["type"] === "object" && v && typeof v === "object") {
    const props = (branch["properties"] ?? {}) as Record<string, JsonSchema>;
    const extra = branch["additionalProperties"] as JsonSchema | undefined;
    for (const [k, child] of Object.entries(v)) {
      const s = (Object.hasOwn(props, k) ? props[k] : undefined) ?? extra;
      if (s && typeof s === "object") assertOnlyNone(s, child, recordClass);
    }
  } else if (branch["type"] === "array" && Array.isArray(v)) {
    v.forEach((c) => assertOnlyNone(branch["items"] as JsonSchema, c, recordClass));
  }
}

describe("egress projection", () => {
  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s: planted members and off-schema values never pass",
    (name, contract) => {
      const schema = committedSchema(name);
      fc.assert(
        fc.property(
          arbitraryFor(contract.schema),
          fc.constantFrom(...DATA_CLASSES),
          fc.integer({ min: 0, max: 7 }),
          (record, maxClass: DataClass, every) => {
            let n = 0;
            const planted = plant(schema, record, () => every > 0 && n++ % (every + 1) === every);
            expect(containsMark(planted)).toBe(true);
            const { value, dropped } = projectForEgress(contract.schema, planted, {
              purpose: "PU-1",
              maxClass,
            });
            expect(containsMark(value)).toBe(false);
            expect(dropped.length).toBeGreaterThan(0);
          },
        ),
        { seed: 20261115, numRuns: 150 },
      );
    },
  );

  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s: at maxClass none, no output leaf has a policy above none",
    (name, contract) => {
      const schema = committedSchema(name);
      fc.assert(
        fc.property(arbitraryFor(contract.schema), (record) => {
          const { value } = projectForEgress(contract.schema, record, {
            purpose: "PU-1",
            maxClass: "none",
          });
          const recordClass = (record as { dataClass?: string }).dataClass ?? "special";
          assertOnlyNone(schema, value, recordClass);
        }),
        { seed: 20261115, numRuns: 100 },
      );
    },
  );

  it("drops content of a personal record under the default-deny destination", () => {
    const trial = Trial.parse({
      ...baseTrial,
      dataClass: "personal",
      output: { text: "Alice wrote…" },
    });
    const { value, dropped } = projectForEgress(Trial, trial, {
      purpose: "PU-2",
      maxClass: "none",
    });
    expect(value).not.toHaveProperty("output");
    expect(value).not.toHaveProperty("input");
    expect(dropped).toContain("/output");
    expect(value).toHaveProperty("outcome", "completed");
  });

  it("lets content of a synthetic record leave under the default-deny destination", () => {
    const trial = Trial.parse({ ...baseTrial, dataClass: "none", output: { text: "synthetic" } });
    expect(
      projectForEgress(Trial, trial, { purpose: "PU-2", maxClass: "none" }).value,
    ).toHaveProperty("output", { text: "synthetic" });
  });

  it("treats content of a record without a declared class as the most sensitive", () => {
    const { value } = projectForEgress(
      Trial,
      { ...baseTrial, dataClass: undefined, output: { text: "?" } },
      { purpose: "PU-2", maxClass: "personal" },
    );
    expect(value).not.toHaveProperty("output");
  });

  it("drops a pseudonym unless the purpose is on its allow-list", () => {
    const label = Label.parse(baseLabel);
    expect(
      projectForEgress(Label, label, { purpose: "PU-3", maxClass: "personal" }).value,
    ).not.toHaveProperty("rater");
    expect(
      projectForEgress(Label, label, { purpose: "PU-3", maxClass: "none" }).value,
    ).not.toHaveProperty("rater");
  });

  it("drops join keys and pointers (quasi-identifiers without an allow-list) at every destination", () => {
    const trial = Trial.parse({
      ...baseTrial,
      joinKeys: { session: "psn1_s_abc" },
      pointer: "app://item/42",
    });
    const { value } = projectForEgress(Trial, trial, { purpose: "PU-1", maxClass: "special" });
    expect(value).not.toHaveProperty("joinKeys");
    expect(value).not.toHaveProperty("pointer");
  });

  it("drops a monitor's owner, which may name a person", () => {
    const monitor = Monitor.parse({
      schema: "ichnaea.monitor/1",
      id: "m",
      measure: "app/rate",
      sampling: "census",
      statistic: "bernoulli-cusum",
      parameters: {},
      reference: 0.1,
      falseAlarmsPerYear: 1,
      practicalMargin: 0.02,
      owner: "Alice Example",
      action: "page",
      severity: "warning",
    });
    expect(
      projectForEgress(Monitor, monitor, { purpose: "PU-1", maxClass: "none" }).value,
    ).not.toHaveProperty("owner");
  });

  it.each([
    [
      "an off-schema object in a union",
      MeasureValue,
      {
        ...baseValue,
        value: { type: "score", value: { nonFinite: "NaN", email: "alice@example.com" } },
      },
    ],
    [
      "an object inside a numeric matrix",
      Calibration,
      { ...baseCalibration, confusion: [[{ email: "alice@example.com" }]] },
    ],
  ])("drops %s instead of copying it", (_, schema, record) => {
    const { value } = projectForEgress(schema, record, { purpose: "PU-1", maxClass: "none" });
    expect(JSON.stringify(value)).not.toContain("alice@example.com");
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])(
    "drops a member named %s without failing",
    (key) => {
      const record = JSON.parse(
        `{"schema":"ichnaea.trial/1","id":"t-1","${key}":{"email":"alice@example.com"}}`,
      ) as unknown;
      const { value } = projectForEgress(Trial, record, { purpose: "PU-1", maxClass: "none" });
      expect(JSON.stringify(value)).not.toContain("alice@example.com");
    },
  );

  it("keeps classified members of records such as configuration parameters and factors", () => {
    const config = Configuration.parse({
      schema: "ichnaea.configuration/1",
      description: "d",
      models: [
        {
          role: "a",
          provider: { value: "p", status: "pinned" },
          id: { value: "m", status: "pinned" },
        },
      ],
      parameters: [{ name: "t", value: 0.2, status: "pinned", origin: "explicit" }],
      prompts: [],
      factors: { "code.commit": { value: "abc", status: "pinned", part: "code" } },
    });
    const { value } = projectForEgress(Configuration, config, {
      purpose: "PU-1",
      maxClass: "none",
    });
    expect(value).toEqual(config);
  });
});

const baseTrial = {
  schema: "ichnaea.trial/1",
  id: "t-1",
  source: "offline",
  case: "c-1",
  unit: "turn",
  configuration: `sha256:${"a".repeat(64)}`,
  replicate: 0,
  outcome: "completed",
  dataClass: "none",
  input: { q: "?" },
};
const baseLabel = {
  schema: "ichnaea.label/1",
  trial: "t-1",
  measure: "app/grounded",
  value: { type: "binary", pass: true },
  rater: "psn1_r_x",
  raterRole: "expert",
  source: "bundle",
  rubricDigest: `sha256:${"b".repeat(64)}`,
  labelledAt: "2026-11-15T12:00:00Z",
  dataClass: "none",
};
const baseValue = {
  schema: "ichnaea.measureValue/1",
  trial: "t-1",
  measure: "app/m",
  version: "1.0.0",
  applicable: true,
  source: "ichnaea",
  dataClass: "none",
};
const baseCalibration = {
  schema: "ichnaea.calibration/1",
  judge: "app/j",
  judgeDigest: `sha256:${"c".repeat(64)}`,
  measure: "app/m",
  calibrationSet: `sha256:${"d".repeat(64)}`,
  humanHuman: [],
  judgeHuman: [],
  confusion: [[1]],
  tolerance: 0.1,
  status: "diagnostic",
  expiry: [],
  createdAt: "2026-11-15T12:00:00Z",
};

describe("egress projection: regressions", () => {
  it("keeps a __proto__ record key as data and never sets the output's prototype", () => {
    const raw = JSON.parse(
      `{"schema":"ichnaea.trial/1","id":"t-1","source":"offline","case":"c-1","unit":"turn","configuration":"sha256:${"a".repeat(64)}","replicate":0,"outcome":"completed","dataClass":"none","signals":{"__proto__":{"x":1}}}`,
    ) as unknown;
    const { value } = projectForEgress(Trial, raw, { purpose: "PU-1", maxClass: "none" });
    const signals = (value as { signals: object }).signals;
    expect(Object.hasOwn(signals, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(signals)).toBe(Object.prototype);
  });

  it("drops observations and slices of a personal record at the default-deny destination", () => {
    const trial = Trial.parse({
      ...baseTrial,
      dataClass: "personal",
      observed: [{ name: "returned", value: { user: "alice" } }],
    });
    expect(
      JSON.stringify(projectForEgress(Trial, trial, { purpose: "PU-1", maxClass: "none" }).value),
    ).not.toContain("alice");
  });

  it("lets a deployment grant a purpose for a named field, within the class limit", () => {
    const label = Label.parse(baseLabel);
    const grants = [{ path: "/rater", purposes: ["PU-3"] }];
    expect(
      projectForEgress(Label, label, { purpose: "PU-3", maxClass: "pseudonymous", grants }).value,
    ).toHaveProperty("rater");
    expect(
      projectForEgress(Label, label, { purpose: "PU-5", maxClass: "pseudonymous", grants }).value,
    ).not.toHaveProperty("rater");
    expect(
      projectForEgress(Label, label, { purpose: "PU-3", maxClass: "none", grants }).value,
    ).not.toHaveProperty("rater");
  });

  it("a grant matches the whole path, never a prefix of it", () => {
    const label = Label.parse(baseLabel);
    for (const path of ["/rate", "/", "", "/rater/x", "/*/x"]) {
      const grants = [{ path, purposes: ["PU-3"] }];
      expect(
        projectForEgress(Label, label, { purpose: "PU-3", maxClass: "pseudonymous", grants }).value,
      ).not.toHaveProperty("rater");
    }
    const wildcard = [{ path: "/*", purposes: ["PU-3"] }];
    expect(
      projectForEgress(Label, label, {
        purpose: "PU-3",
        maxClass: "pseudonymous",
        grants: wildcard,
      }).value,
    ).toHaveProperty("rater");
  });

  it("escapes dropped paths as JSON pointers", () => {
    const { dropped } = projectForEgress(
      Trial,
      { ...baseTrial, "a/b~c": 1 },
      { purpose: "PU-1", maxClass: "none" },
    );
    expect(dropped).toContain("/a~1b~0c");
  });
});
