// Writes fixtures/valid/<record>.json and fixtures/invalid/<record>/<variant>.json.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { caseDigest, caseSetDigest, configurationIdentity } from "../src/index.ts";
import { CONFIGURATION_B, INVALID, READER_ONLY, VALID } from "./fixtures-source.ts";

const root = join(import.meta.dirname, "..", "fixtures");
for (const dir of ["valid", "invalid", "reader-only"])
  rmSync(join(root, dir), { recursive: true, force: true });
const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
// Every cross-reference in the valid fixtures is computed, so the fixtures teach the real links.
type Rec = Record<string, unknown>;
const valid = VALID as Record<string, Rec>;
const plan = valid["plan"] as Rec & { arms: Rec[]; caseSetDigest: string };
const base = await configurationIdentity(valid["configuration"]);
const candidate = await configurationIdentity(CONFIGURATION_B);
plan.arms[0]!["identity"] = base;
plan.arms[1]!["identity"] = candidate;
(valid["run"] as Rec)["arms"] = structuredClone(plan.arms);
const decisionArms = (valid["decision"] as { arms: Rec[] }).arms;
decisionArms[0]!["identity"] = base;
decisionArms[1]!["identity"] = candidate;
(valid["trial"] as Rec)["configuration"] = candidate;
const english = {
  ...structuredClone(valid["case"]),
  id: "refund-window-en",
  input: { question: "Can I return it after 40 days?", lang: "en" },
};
const entry = async (c: Rec): Promise<Rec> => ({
  id: c["id"],
  digest: await caseDigest(c),
  pool: c["pool"],
  family: c["family"],
});
const caseSet = valid["caseSet"] as Rec & { cases: Rec[]; digest: string };
caseSet.cases = [await entry(valid["case"] as Rec), await entry(english)];
caseSet.digest = await caseSetDigest(caseSet.cases);
plan.caseSetDigest = caseSet.digest;
(valid["trial"] as Rec)["caseDigest"] = await caseDigest(valid["case"]);
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
