// Tests added for the independent contracts review (M2-contracts-review.md): each pins a behaviour
// that a surviving mutation showed was untested.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  Calibration,
  Case,
  caseForTarget,
  contractFor,
  DATA_POLICY_KEY,
  DATA_CLASSES,
  lintContractSchema,
  lintDataPolicies,
  none,
  PURPOSES,
  pseudonym,
  projectForEgress,
  readRecord,
  RECORD_CONTRACTS,
  Trial,
} from "../src/index.ts";
import { committedSchema } from "./support/ajv.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", `${name}.json`), "utf8"),
  ) as Record<string, unknown>;

describe("M4: per-rater agreement never leaves the calibration record", () => {
  it.each(DATA_CLASSES.flatMap((c) => PURPOSES.map((p) => [c, p] as const)))(
    "is absent at maxClass %s for %s without a grant",
    (maxClass, purpose) => {
      const record = Calibration.parse({
        ...fixture("calibration"),
        perRater: [
          {
            rater: "psn1_r_a",
            items: 40,
            agreement: [
              { statistic: "cohen-kappa", estimate: 0.61, lower: 0.4, upper: 0.8, n: 40 },
            ],
          },
        ],
      });
      expect(projectForEgress(Calibration, record, { purpose, maxClass }).value).not.toHaveProperty(
        "perRater",
      );
    },
  );
});

describe("M5: unclassified fields and unknown data classes never pass", () => {
  const plugin = z.strictObject({
    dataClass: none(z.enum(DATA_CLASSES)),
    ok: none(z.string()),
    secret: z.string(),
    nested: z.strictObject({ ok: none(z.string()), secret: z.string() }),
    list: z.array(z.strictObject({ ok: none(z.string()), secret: z.string() })),
  });

  it("drops unclassified fields at the top level, in a nested object and in an array", () => {
    const record = {
      dataClass: "none",
      ok: "a",
      secret: "s1",
      nested: { ok: "b", secret: "s2" },
      list: [{ ok: "c", secret: "s3" }],
    };
    const { value, dropped } = projectForEgress(plugin, record, {
      purpose: "PU-1",
      maxClass: "special",
    });
    expect(value).toEqual({ dataClass: "none", ok: "a", nested: { ok: "b" }, list: [{ ok: "c" }] });
    expect(dropped).toEqual(
      expect.arrayContaining(["/secret", "/nested/secret", "/list/0/secret"]),
    );
    expect(lintDataPolicies(plugin).map((v) => v.path)).toEqual([
      "$.secret",
      "$.nested.secret",
      "$.list.[].secret",
    ]);
  });

  it("treats content of a record with an unknown data class (from a tolerant read) as special", () => {
    const raw = { ...fixture("trial"), dataClass: "restricted", output: { text: "secret" } };
    const read = readRecord(contractFor("ichnaea.trial/1") as never, raw);
    expect(read.ok).toBe(true);
    const { value } = projectForEgress(Trial, raw, { purpose: "PU-1", maxClass: "personal" });
    expect(value).not.toHaveProperty("output");
  });
});

const policyAt = (name: string, pointer: string): Record<string, unknown> => {
  let node = committedSchema(name) as Record<string, unknown>;
  for (const segment of pointer.split("/").filter(Boolean)) {
    const props = node["properties"] as Record<string, Record<string, unknown>> | undefined;
    node = (
      segment === "[]"
        ? node["items"]
        : segment === "|"
          ? (node["anyOf"] as Array<Record<string, unknown>>)[0]
          : props?.[segment]
    ) as Record<string, unknown>;
    if (!node) throw new Error(`no ${pointer} in ${name}`);
    if (!props && segment !== "[]" && segment !== "|") throw new Error(`${pointer}`);
  }
  return node[DATA_POLICY_KEY] as Record<string, unknown>;
};

describe("m7: the class of each sensitive field is pinned", () => {
  it.each([
    ["case", "/references", "inherit", "content"],
    ["case", "/input", "inherit", "content"],
    ["case", "/slices", "inherit", "quasi"],
    ["case", "/validation/note", "inherit", "content"],
    ["trial", "/output", "inherit", "content"],
    ["trial", "/error/message", "inherit", "content"],
    ["trial", "/pointer", "pseudonymous", "quasi"],
    ["trial", "/joinKeys", "pseudonymous", "quasi"],
    ["label", "/rater", "pseudonymous", "direct"],
    ["label", "/rationale", "inherit", "content"],
    ["calibration", "/perRater", "pseudonymous", "direct"],
    ["monitor", "/owner", "personal", "direct"],
    ["finding", "/pointers", "pseudonymous", "quasi"],
  ])("%s %s is %s (%s)", (name, pointer, dataClass, identifier) => {
    const policy = policyAt(name, pointer);
    expect(policy["class"]).toBe(dataClass);
    expect(policy["identifier"]).toBe(identifier);
    expect(policy["egress"]).toEqual(dataClass === "inherit" ? ["*"] : []);
  });

  it("case provenance author is personal in every provenance kind", () => {
    const options = (
      committedSchema("case")["properties"] as Record<string, Record<string, unknown>>
    )["provenance"]!["oneOf"] as Array<Record<string, Record<string, Record<string, unknown>>>>;
    for (const option of options)
      expect(option["properties"]!["author"]![DATA_POLICY_KEY]).toMatchObject({
        class: "personal",
        identifier: "direct",
      });
  });
});

describe("m10: the target view copies every part it passes", () => {
  it("copies turns and fixtures as well as the input", () => {
    const record = Case.parse({ ...fixture("case") });
    const view = caseForTarget(record);
    (view.turns as Array<{ content: unknown }>)[0]!.content = "changed";
    (view.fixtures as Array<{ name: string }>)[0]!.name = "changed";
    expect(record.turns?.[0]?.content).not.toBe("changed");
    expect(record.fixtures?.[0]?.name).not.toBe("changed");
  });
});

describe("m11, m16: the lints", () => {
  it("rejects a lazy schema other than the JSON value, with a refinement inside", () => {
    const lazy = z.strictObject({ a: z.lazy(() => z.string().refine(() => true)) });
    expect(lintContractSchema(lazy).length).toBeGreaterThan(0);
  });

  it("rejects a permissive policy on a container whose members are unclassified", () => {
    expect(
      lintDataPolicies(z.strictObject({ a: none(z.strictObject({ owner: z.string() })) })).map(
        (v) => v.path,
      ),
    ).toEqual(["$.a.owner"]);
  });

  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s passes the data-policy lint",
    (_, contract) => {
      expect(lintDataPolicies(contract.schema)).toEqual([]);
    },
  );
});

describe("m12: valid data survives an egress it may pass", () => {
  it.each([
    "measureValue",
    "decision",
    "case",
    "trial",
    "caseSet",
    "configuration",
    "plan",
    "suite",
    "run",
    "measureCard",
  ])("%s with data class none comes back intact at maxClass none", (name) => {
    const contract = RECORD_CONTRACTS.find((c) => c.name === name)!;
    fc.assert(
      fc.property(arbitraryFor(contract.schema), (generated) => {
        const record = { ...(generated as Record<string, unknown>) };
        if ("dataClass" in record) record["dataClass"] = "none";
        // Fields that are pseudonymous or personal by contract never pass at maxClass none.
        for (const key of ["pointer", "joinKeys"]) delete record[key];
        if (name === "case" && record["provenance"])
          delete (record["provenance"] as Record<string, unknown>)["author"];
        if (!contract.schema.safeParse(record).success) return;
        expect(
          projectForEgress(contract.schema, record, { purpose: "PU-1", maxClass: "none" }).value,
        ).toEqual(record);
      }),
      { seed: 20261115, numRuns: 100 },
    );
  });
});

describe("M7: contract package boundaries (REQ-06, DN-1)", () => {
  it("has no runtime dependency, and zod only as its peer", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    expect(manifest["dependencies"] ?? {}).toEqual({});
    expect(Object.keys(manifest["peerDependencies"] ?? {})).toEqual(["zod"]);
  });
});

describe("egress edge paths (mutants E3, E9)", () => {
  it("drops a record key that its key schema refuses", () => {
    const schema = z.strictObject({
      dataClass: none(z.enum(DATA_CLASSES)),
      factors: none(z.record(z.string().min(1), z.string())),
    });
    const { value, dropped } = projectForEgress(
      schema,
      { dataClass: "none", factors: { "": "x", ok: "y" } },
      { purpose: "PU-1", maxClass: "none" },
    );
    expect(value).toEqual({ dataClass: "none", factors: { ok: "y" } });
    expect(dropped).toContain("/factors/");
  });

  it("checks the policy of a null value like any other", () => {
    const schema = z.strictObject({
      secret: pseudonym(z.string().nullable()),
      loose: z.string().nullable(),
      open: none(z.string().nullable()),
    });
    const { value } = projectForEgress(
      schema,
      { secret: null, loose: null, open: null },
      { purpose: "PU-1", maxClass: "none" },
    );
    expect(value).toEqual({ open: null });
  });
});
