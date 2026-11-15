// REQ-135 (and the contract half of REQ-126): unknown and unclassified fields never pass an egress;
// personal and content fields pass only within the destination's class and purpose.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type * as z from "zod";

import { Label, projectForEgress, RECORD_CONTRACTS, Trial } from "../src/index.ts";
import { children, defType, unwrap } from "../src/walk.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const MARK = "__ichnaea_unknown__";

/** Adds an unknown member to every object that the schema defines (not inside opaque JSON). */
function plantUnknown(schema: z.ZodType, value: unknown): unknown {
  const inner = unwrap(schema);
  const type = defType(inner);
  if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const shape = Object.fromEntries(children(inner));
    const out: Record<string, unknown> = { [MARK]: "secret" };
    for (const [k, v] of Object.entries(value)) out[k] = shape[k] ? plantUnknown(shape[k], v) : v;
    return out;
  }
  if (type === "array" && Array.isArray(value)) {
    const element = children(inner)[0]![1];
    return value.map((v) => plantUnknown(element, v));
  }
  if (type === "union") {
    const option = children(inner)
      .map(([, o]) => o)
      .find((o) => o.safeParse(value).success);
    return option ? plantUnknown(option, value) : value;
  }
  return value;
}

const containsMark = (value: unknown): boolean => JSON.stringify(value ?? null).includes(MARK);

describe("egress projection", () => {
  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s: an unknown field never passes",
    (_, contract) => {
      fc.assert(
        fc.property(
          arbitraryFor(contract.schema),
          fc.constantFrom("none", "pseudonymous", "personal", "special" as const),
          (record, maxClass) => {
            const planted = plantUnknown(contract.schema, record);
            expect(containsMark(planted)).toBe(true);
            const { value, dropped } = projectForEgress(contract.schema, planted, {
              purpose: "PU-1",
              maxClass,
            });
            expect(containsMark(value)).toBe(false);
            expect(dropped.some((p) => p.endsWith(MARK))).toBe(true);
          },
        ),
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
    const { value } = projectForEgress(Trial, trial, { purpose: "PU-2", maxClass: "none" });
    expect(value).toHaveProperty("output", { text: "synthetic" });
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
    const label = Label.parse({ ...baseLabel });
    const deny = projectForEgress(Label, label, { purpose: "PU-3", maxClass: "personal" });
    expect(deny.value).not.toHaveProperty("rater");
    const tooLow = projectForEgress(Label, label, { purpose: "PU-3", maxClass: "none" });
    expect(tooLow.value).not.toHaveProperty("rater");
  });

  it("drops join keys (pseudonymous, no allow-list) at every destination", () => {
    const trial = Trial.parse({ ...baseTrial, joinKeys: { session: "psn1_s_abc" } });
    expect(
      projectForEgress(Trial, trial, { purpose: "PU-1", maxClass: "special" }).value,
    ).not.toHaveProperty("joinKeys");
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
  value: true,
  rater: "psn1_r_x",
  raterRole: "expert",
  source: "bundle",
  rubricDigest: `sha256:${"b".repeat(64)}`,
  labelledAt: "2026-11-15T12:00:00Z",
  dataClass: "none",
};
