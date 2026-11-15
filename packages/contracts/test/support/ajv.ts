import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { DATA_POLICY_KEY, RECORD_CONTRACTS, schemaUri } from "../../src/index.ts";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

/** Reads the committed, normative JSON Schema file of a record contract. */
export function committedSchema(name: string): Record<string, unknown> {
  const path = join(import.meta.dirname, "..", "..", "schemas", `${name}.schema.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** An ajv 2020-12 validator in strict mode over the committed schema files. */
export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: DATA_POLICY_KEY, schemaType: "object" });
  ajv.addKeyword({ keyword: "x-ichnaea-stability", schemaType: "string" });
  ajv.addKeyword({ keyword: "x-ichnaea-known", schemaType: "array" });
  ajv.addKeyword({ keyword: "x-ichnaea-unknown-kind", schemaType: "boolean" });
  for (const contract of RECORD_CONTRACTS) {
    ajv.addSchema(committedSchema(contract.name));
    ajv.addSchema(committedSchema(`${contract.name}.reader`));
  }
  return ajv;
}

/** Validates a value with ajv against the committed schema of a contract. */
export function ajvValidate(
  ajv: Ajv2020,
  name: string,
  value: unknown,
  variant: "writer" | "reader" = "writer",
): boolean {
  const contract = RECORD_CONTRACTS.find((c) => c.name === name);
  if (!contract) throw new Error(`no contract ${name}`);
  const validate = ajv.getSchema(schemaUri(contract, variant));
  if (!validate) throw new Error(`no schema for ${name}`);
  return validate(value) as boolean;
}
