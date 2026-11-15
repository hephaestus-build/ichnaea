// Writes fixtures/valid/<record>.json and fixtures/invalid/<record>/<variant>.json.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { caseSetDigest } from "../src/index.ts";
import { INVALID, READER_ONLY, VALID } from "./fixtures-source.ts";

const root = join(import.meta.dirname, "..", "fixtures");
for (const dir of ["valid", "invalid", "reader-only"])
  rmSync(join(root, dir), { recursive: true, force: true });
const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
// The case set fixture carries the real digest of its entries.
const caseSet = VALID["caseSet"] as { cases: Parameters<typeof caseSetDigest>[0]; digest: string };
caseSet.digest = await caseSetDigest(caseSet.cases);
let count = 0;
for (const [name, record] of Object.entries(VALID)) {
  write(join(root, "valid", `${name}.json`), record);
  count++;
  for (const [variant, mutate] of Object.entries(INVALID[name] ?? {})) {
    const copy = structuredClone(record);
    mutate(copy);
    write(join(root, "invalid", name, `${variant}.json`), copy);
    count++;
  }
  for (const [variant, mutate] of Object.entries(READER_ONLY[name] ?? {})) {
    const copy = structuredClone(record);
    mutate(copy);
    write(join(root, "reader-only", name, `${variant}.json`), copy);
    count++;
  }
}
console.log(`wrote ${count} fixtures`);
