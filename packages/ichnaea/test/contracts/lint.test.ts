// REQ-02: no refinements, transforms or defaults in contract schemas, checked by a lint that fails
// on a planted violation.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as z from "zod";

import { lintContractSchema, RECORD_CONTRACTS } from "../../src/contracts/index.ts";

describe("contract lint", () => {
  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s has no refinement, transform or default",
    (_, contract) => {
      expect(lintContractSchema(contract.schema)).toEqual([]);
    },
  );

  it.each([
    ["refine", z.object({ a: z.string().refine((s) => s.length > 1) })],
    ["superRefine", z.object({ a: z.string() }).superRefine(() => undefined)],
    ["transform", z.object({ a: z.string().transform((s) => s.length) })],
    ["default", z.object({ a: z.string().default("x") })],
    ["catch", z.object({ a: z.string().catch("x") })],
    ["pipe", z.object({ a: z.string().pipe(z.string()) })],
    ["preprocess", z.object({ a: z.preprocess((v) => v, z.string()) })],
    ["custom", z.object({ a: z.custom<string>(() => true) })],
    ["date", z.object({ a: z.date() })],
    ["nested in array", z.object({ a: z.array(z.object({ b: z.number().default(1) })) })],
    ["trim", z.object({ a: z.string().trim() })],
    ["toLowerCase", z.object({ a: z.string().toLowerCase() })],
    ["overwrite", z.object({ a: z.number().overwrite((n) => n + 1) })],
    ["refine inside a tuple", z.object({ a: z.tuple([z.string().refine(() => true)]) })],
    ["default under nonoptional", z.object({ a: z.string().default("x").nonoptional() })],
    ["any", z.object({ a: z.any() })],
    ["unknown", z.object({ a: z.unknown() })],
  ])("rejects a planted %s", (_, schema) => {
    expect(lintContractSchema(schema).length).toBeGreaterThan(0);
  });

  it("finds no refinement or transform call in the contract sources", () => {
    const dir = join(import.meta.dirname, "..", "..", "src", "contracts", "records");
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(
        /\.(refine|superRefine|transform|default|prefault|catch|check|pipe)\(|z\.(preprocess|custom)\(/,
      );
    }
  });
});
