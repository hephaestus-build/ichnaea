// A major contract change ships with a migration (REQ-07): every record's registered majors are
// listed in packages/ichnaea/majors.json. Check the previous records with today's tolerant reader.
// A removed major must migrate them to a record that the current reader or writer accepts.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { readRecord } from "../packages/ichnaea/src/contracts/reader.ts";
import {
  RECORD_CONTRACTS,
  type RecordContract,
} from "../packages/ichnaea/src/contracts/registry.ts";

type Majors = Readonly<Record<string, Readonly<Record<string, string | null>>>>;
type Migrate = (record: unknown) => unknown;

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
  majors: Majors,
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

/** Load a migration inside the package that exports a callable `migrate(record)`. */
async function loadMigration(root: string, file: string): Promise<Migrate> {
  const path = realpathSync(join(root, file));
  const local = relative(realpathSync(root), path);
  if (isAbsolute(local) || local.split(sep)[0] === ".." || !/\.[cm]?ts$/.test(local))
    throw new Error("expected a TypeScript migration module inside the package");
  const module: { migrate?: unknown } = await import(pathToFileURL(path).href);
  if (typeof module.migrate !== "function") throw new Error("no callable export named migrate");
  return module.migrate as Migrate;
}

const schemaOf = (value: unknown): unknown =>
  value && typeof value === "object" && "schema" in value ? value.schema : undefined;

/** Check base-commit fixtures even when the branch regenerated its own fixtures. */
async function compatibilityProblems(
  root: string,
  majors: Majors,
  migrations: ReadonlyMap<string, Migrate>,
): Promise<string[]> {
  const cwd = join(root, "..", "..");
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let base = process.env["ICHNAEA_CONTRACT_BASE"];
  if (!base) {
    try {
      base = git("merge-base", "HEAD", "origin/main").trim();
    } catch {
      base = "HEAD";
    }
  }
  const fixtures = git(
    "ls-tree",
    "-rz",
    "--name-only",
    base,
    "--",
    ...["valid", "valid-extra", "reader-only"].map((kind) => `packages/ichnaea/fixtures/${kind}`),
  )
    .split("\0")
    .filter(Boolean);
  if (fixtures.length === 0) throw new Error(`no contract fixtures in base commit '${base}'`);
  const contracts = new Map<string, RecordContract>(RECORD_CONTRACTS.map((c) => [c.id, c]));
  const problems: string[] = [];
  for (const file of fixtures) {
    try {
      let value: unknown = JSON.parse(git("show", `${base}:${file}`));
      const original = schemaOf(value);
      if (typeof original !== "string") throw new Error("fixture has no schema ID");
      const { record, major } = recordOf(original);
      let id = original;
      let contract = contracts.get(id);
      for (let next = major + 1; !contract; next++) {
        const path = majors[record]?.[next];
        const migrate = path ? migrations.get(path) : undefined;
        if (!migrate) throw new Error(`${id} was removed without a migration to major ${next}`);
        value = await migrate(value);
        id = `ichnaea.${record}/${next}`;
        if (schemaOf(value) !== id) throw new Error(`${path} did not produce ${id}`);
        contract = contracts.get(id);
      }
      if (id === original || file.startsWith("packages/ichnaea/fixtures/reader-only/")) {
        const read = readRecord(contract, value);
        if (!read.ok) throw read.error;
      } else {
        contract.schema.parse(value);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${file}: ${message}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "packages", "ichnaea");
  const majors = (
    JSON.parse(readFileSync(join(root, "majors.json"), "utf8")) as { records: Majors }
  ).records;
  const migrations = new Map<string, Migrate>();
  const problems: string[] = [];
  const paths = new Set(Object.values(majors).flatMap((versions) => Object.values(versions)));
  for (const path of paths) {
    if (path === null) continue;
    try {
      migrations.set(path, await loadMigration(root, path));
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  problems.push(...majorProblems(RECORD_CONTRACTS, majors, (path) => migrations.has(path)));
  problems.push(...(await compatibilityProblems(root, majors, migrations)));
  if (problems.length > 0) {
    console.error(`contract majors:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`contract majors: ${RECORD_CONTRACTS.length} record contracts consistent`);
}
