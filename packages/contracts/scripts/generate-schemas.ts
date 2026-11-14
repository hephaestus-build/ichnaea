// Writes the normative JSON Schema files from the zod sources. CI fails when they differ.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RECORD_CONTRACTS, toJsonSchema } from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "schemas");
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) if (file.endsWith(".schema.json")) rmSync(join(dir, file));
for (const contract of RECORD_CONTRACTS) {
  writeFileSync(
    join(dir, `${contract.name}.schema.json`),
    `${JSON.stringify(toJsonSchema(contract), null, 2)}\n`,
  );
}
console.log(`wrote ${RECORD_CONTRACTS.length} schemas to ${dir}`);
