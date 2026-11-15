// Writes fixtures/valid/<record>.json and fixtures/invalid/<record>/<variant>.json.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { INVALID, VALID } from "./fixtures-source.ts";

const root = join(import.meta.dirname, "..", "fixtures");
rmSync(root, { recursive: true, force: true });
const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
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
}
console.log(`wrote ${count} fixtures`);
