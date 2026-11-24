// Checks the package that a consumer installs: packs a build tree with npm, as npm would publish
// it, and runs publint in strict mode and Are the Types Wrong on that one tarball (REQ-110). The
// package is ESM only, so attw's esm-only profile leaves out the CommonJS and node10 resolutions.
// A release runs this before packing the tarball it stages.
// Usage: node scripts/check-package.ts <build tree>   (a directory from scripts/build-package.ts)
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPOSITORY = join(import.meta.dirname, "..");
const bin = (name: string): string => join(REPOSITORY, "node_modules", ".bin", name);

/** Runs a command and returns its exit status and combined output. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
): { status: number; out: string } {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

/** Packs `tree` with npm into a new directory and returns the tarball's path. */
export function pack(tree: string): string {
  const destination = mkdtempSync(join(tmpdir(), "ichnaea-pack-"));
  const packed = run("npm", ["pack", "--silent", "--pack-destination", destination], tree);
  if (packed.status !== 0) throw new Error(`npm pack failed in ${tree}:\n${packed.out}`);
  const [tarball, ...more] = readdirSync(destination).filter((f) => f.endsWith(".tgz"));
  if (tarball === undefined || more.length > 0)
    throw new Error(`npm pack wrote ${more.length + (tarball ? 1 : 0)} tarballs, not one`);
  return join(destination, tarball);
}

/** The failures of publint --strict and attw on the npm-packed tree, one message per tool. */
export function packageProblems(tree: string): string[] {
  const tarball = pack(resolve(tree));
  try {
    const problems: string[] = [];
    const lint = run(bin("publint"), ["run", tarball, "--strict"], REPOSITORY);
    if (lint.status !== 0) problems.push(`publint --strict failed:\n${lint.out}`);
    const types = run(bin("attw"), [tarball, "--profile", "esm-only"], REPOSITORY);
    if (types.status !== 0) problems.push(`attw failed:\n${types.out}`);
    return problems;
  } finally {
    rmSync(join(tarball, ".."), { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [tree] = process.argv.slice(2);
  if (tree === undefined) throw new Error("usage: check-package.ts <build tree>");
  const problems = packageProblems(tree);
  for (const p of problems) console.error(p);
  if (problems.length > 0) process.exit(1);
  console.log("package: publint --strict and attw (esm-only) pass on the npm-packed build tree");
}
