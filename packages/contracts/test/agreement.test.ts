// REQ-01, REQ-05, REQ-108: zod and ajv agree on every shared fixture and on generated records.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { readRecord, RECORD_CONTRACTS, toJsonSchema, toReaderJsonSchema } from "../src/index.ts";
import { ajvValidate, committedSchema, createAjv } from "./support/ajv.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const fixtures = join(import.meta.dirname, "..", "fixtures");

/** Every path to a member or element inside a JSON value. */
function memberPaths(
  value: unknown,
  prefix: Array<string | number> = [],
): Array<Array<string | number>> {
  if (Array.isArray(value))
    return value.flatMap((v, i) => [[...prefix, i], ...memberPaths(v, [...prefix, i])]);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      [...prefix, k],
      ...memberPaths(v, [...prefix, k]),
    ]);
  }
  return [];
}

/** Sets (or, with undefined, deletes) the member at a path. */
function setPath(
  root: unknown,
  path: ReadonlyArray<string | number>,
  replacement: unknown,
): unknown {
  const parent = path
    .slice(0, -1)
    .reduce<unknown>(
      (node, key) => (node as Record<string | number, unknown>)[key],
      root,
    ) as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (replacement === undefined) {
    if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete parent[last];
  } else parent[last] = replacement;
  return root;
}
const ajv = createAjv();
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("normative JSON Schema files", () => {
  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s is committed and current",
    (name, contract) => {
      expect(committedSchema(name)).toEqual(JSON.parse(JSON.stringify(toJsonSchema(contract))));
      expect(committedSchema(`${name}.reader`)).toEqual(
        JSON.parse(JSON.stringify(toReaderJsonSchema(contract))),
      );
    },
  );
});

describe("shared fixtures", () => {
  it("every contract has a valid fixture and at least one invalid fixture", () => {
    for (const { name } of RECORD_CONTRACTS) {
      expect(readdirSync(join(fixtures, "valid"))).toContain(`${name}.json`);
      expect(readdirSync(join(fixtures, "invalid", name)).length).toBeGreaterThan(0);
    }
  });

  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s valid fixture passes zod and ajv",
    (name, contract) => {
      const value = read(join(fixtures, "valid", `${name}.json`));
      expect(contract.schema.safeParse(value).success).toBe(true);
      expect(ajvValidate(ajv, name, value)).toBe(true);
    },
  );

  const invalid = RECORD_CONTRACTS.flatMap((c) =>
    readdirSync(join(fixtures, "invalid", c.name)).map((file) => [`${c.name}/${file}`, c] as const),
  );
  it.each(invalid)("%s fails zod and ajv", (file, contract) => {
    const value = read(join(fixtures, "invalid", file));
    expect(contract.schema.safeParse(value).success).toBe(false);
    expect(ajvValidate(ajv, contract.name, value)).toBe(false);
  });

  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s accepts unknown fields in both validators (REQ-05)",
    (name, contract) => {
      const value = read(join(fixtures, "valid", `${name}.json`)) as Record<string, unknown>;
      const extended = { ...value, futureField: { added: "in a later minor version" } };
      expect(contract.schema.safeParse(extended).success).toBe(true);
      expect(ajvValidate(ajv, name, extended)).toBe(true);
    },
  );
});

describe("generated records", () => {
  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s: zod and ajv agree on generated and mutated records",
    (name, contract) => {
      const records = arbitraryFor(contract.schema);
      fc.assert(
        fc.property(records, fc.nat(), (record, pick) => {
          // A generated record is valid in both.
          expect(contract.schema.safeParse(record).success).toBe(true);
          expect(ajvValidate(ajv, name, record)).toBe(true);
          // Removing or corrupting a required field makes both reject it, or both accept it.
          const keys = Object.keys(record as object);
          const key = keys[pick % keys.length] as string;
          for (const broken of [
            Object.fromEntries(Object.entries(record as object).filter(([k]) => k !== key)),
            { ...(record as object), [key]: { unexpected: [1, 2, 3] } },
          ]) {
            expect(ajvValidate(ajv, name, broken)).toBe(contract.schema.safeParse(broken).success);
          }
          // The same at a nested position: delete or corrupt any member or element at any depth.
          const paths = memberPaths(record);
          const path = paths[pick % paths.length];
          if (path) {
            for (const replacement of [undefined, { unexpected: true }, -1, "", null]) {
              const broken = setPath(structuredClone(record), path, replacement);
              expect(ajvValidate(ajv, name, broken)).toBe(
                contract.schema.safeParse(broken).success,
              );
            }
          }
        }),
        { seed: 20261115, numRuns: 200 },
      );
    },
  );
});

describe("tolerant readers (REQ-05)", () => {
  const readerOnly = RECORD_CONTRACTS.flatMap((c) => {
    const dir = join(fixtures, "reader-only", c.name);
    try {
      return readdirSync(dir).map((file) => [`${c.name}/${file}`, c] as const);
    } catch {
      return [];
    }
  });

  it("covers at least eight records with a future enumeration value", () => {
    expect(new Set(readerOnly.map(([, c]) => c.name)).size).toBeGreaterThanOrEqual(8);
  });

  it.each(readerOnly)(
    "%s: writers reject it, readers accept it and report the value",
    (file, contract) => {
      const value = read(join(fixtures, "reader-only", file));
      expect(contract.schema.safeParse(value).success).toBe(false);
      expect(ajvValidate(ajv, contract.name, value)).toBe(false);
      expect(ajvValidate(ajv, contract.name, value, "reader")).toBe(true);
      const result = readRecord(contract, value);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.unknownValues.length).toBeGreaterThanOrEqual(1);
        const [unknown] = result.unknownValues;
        expect(JSON.stringify(result.record)).toContain(JSON.stringify(unknown?.value));
      }
    },
  );

  it.each(
    RECORD_CONTRACTS.flatMap((c) =>
      readdirSync(join(fixtures, "invalid", c.name)).map((f) => [`${c.name}/${f}`, c] as const),
    ),
  )("%s stays invalid for the reader in zod and ajv alike", (file, contract) => {
    const value = read(join(fixtures, "invalid", file));
    expect(ajvValidate(ajv, contract.name, value, "reader")).toBe(readRecord(contract, value).ok);
  });
});
