// Writes the normative JSON Schema files (writer and reader) from the zod sources.
// CI fails when they differ from the committed files.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RECORD_CONTRACTS, toJsonSchema, toReaderJsonSchema } from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "schemas");
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) if (file.endsWith(".schema.json")) rmSync(join(dir, file));
const write = (file: string, schema: unknown): void =>
  writeFileSync(join(dir, file), `${JSON.stringify(schema, null, 2)}\n`);
for (const contract of RECORD_CONTRACTS) {
  write(`${contract.name}.schema.json`, toJsonSchema(contract));
  write(`${contract.name}.reader.schema.json`, toReaderJsonSchema(contract));
}
console.log(`wrote ${RECORD_CONTRACTS.length * 2} schemas to ${dir}`);
