// A major contract change ships with a migration (REQ-07): every record's registered majors are
// listed in packages/ichnaea/majors.json, and every major beyond 1 names a migration module that
// exists, unless the previous major is still registered beside it. A release cannot drop a major
// from the registry without the migration that reads it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RECORD_CONTRACTS } from "../packages/ichnaea/src/contracts/index.ts";

/** The record's name and major from its schema ID: `ichnaea.suite/2` is `suite`, major 2. */
function recordOf(id: string): { record: string; major: number } {
  const [record = "", major = ""] = id.replace(/^ichnaea\./, "").split("/");
  return { record, major: Number(major) };
}

/**
 * Returns one problem per record whose majors and migrations do not line up. majors.json lists the
 * majors under the record's name from its schema ID. Two majors of one record may both be
 * registered, while the code that reads the older one is replaced: a record of the older major
 * then still validates as it is, so the newer major needs no migration yet. Once the older major
 * leaves the registry, the newer one needs its migration.
 */
export function majorProblems(
  contracts: ReadonlyArray<{ name: string; id: string }>,
  majors: Readonly<Record<string, Readonly<Record<string, string | null>>>>,
  exists: (path: string) => boolean,
): string[] {
  const registered = new Map<string, Set<number>>();
  for (const c of contracts) {
    const { record, major } = recordOf(c.id);
    registered.set(record, (registered.get(record) ?? new Set()).add(major));
  }
  const problems: string[] = [];
  for (const [record, majorsOf] of registered) {
    const listed = majors[record];
    if (!listed) {
      problems.push(`${record}: not listed in majors.json`);
      continue;
    }
    const current = Math.max(...majorsOf);
    const highest = Math.max(...Object.keys(listed).map(Number));
    if (highest !== current)
      problems.push(
        `${record}: the contract is at major ${current}, majors.json lists up to ${highest}`,
      );
    for (const major of [...majorsOf].toSorted((a, b) => a - b))
      if (major < current && !Object.hasOwn(listed, String(major)))
        problems.push(`${record}: major ${major} is registered, majors.json does not list it`);
    for (const [major, migration] of Object.entries(listed)) {
      if (Number(major) === 1) continue;
      if (!migration) {
        if (!majorsOf.has(Number(major) - 1))
          problems.push(
            `${record}: major ${major} has no migration from major ${Number(major) - 1}`,
          );
      } else if (!exists(migration))
        problems.push(`${record}: migration ${migration} for major ${major} does not exist`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "packages", "ichnaea");
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
  console.log(`contract majors: ${RECORD_CONTRACTS.length} record contracts consistent`);
}
