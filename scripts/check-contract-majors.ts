// A major contract change ships with a migration (REQ-07, DN-1): every record's current major is
// listed in packages/contracts/majors.json, and every major beyond 1 names a migration module that
// exists. A release cannot carry a new major without one.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RECORD_CONTRACTS } from "../packages/contracts/src/index.ts";

/** Returns one problem per record whose majors and migrations do not line up. */
export function majorProblems(
  contracts: ReadonlyArray<{ name: string; id: string }>,
  majors: Readonly<Record<string, Readonly<Record<string, string | null>>>>,
  exists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const c of contracts) {
    const current = Number(c.id.split("/")[1]);
    const listed = majors[c.name];
    if (!listed) {
      problems.push(`${c.name}: not listed in majors.json`);
      continue;
    }
    const highest = Math.max(...Object.keys(listed).map(Number));
    if (highest !== current)
      problems.push(
        `${c.name}: the contract is at major ${current}, majors.json lists up to ${highest}`,
      );
    for (const [major, migration] of Object.entries(listed)) {
      if (Number(major) === 1) continue;
      if (!migration)
        problems.push(`${c.name}: major ${major} has no migration from major ${Number(major) - 1}`);
      else if (!exists(migration))
        problems.push(`${c.name}: migration ${migration} for major ${major} does not exist`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "packages", "contracts");
  const majors = (
    JSON.parse(readFileSync(join(root, "majors.json"), "utf8")) as {
      records: Record<string, Record<string, string | null>>;
    }
  ).records;
  const problems = majorProblems(RECORD_CONTRACTS, majors, (p) => existsSync(join(root, p)));
  if (problems.length > 0) {
    console.error(`contract majors:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`contract majors: ${RECORD_CONTRACTS.length} records consistent`);
}
