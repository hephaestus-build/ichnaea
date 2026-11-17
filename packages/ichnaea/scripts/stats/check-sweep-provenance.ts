// Checks the sidecars of study outputs (scripts/provenance.ts) against the repository: for each
// output, its <output>.meta.json must name a commit that exists and is HEAD or an ancestor of it,
// and every file it lists must have the recorded sha256 both at that commit and at HEAD. A complete
// output must also still have the sha256 its sidecar records. Fails on the first mismatch per
// output, and lists every failing output.
// Usage: node scripts/check-sweep-provenance.ts <output>... | --all (every committed sidecar)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git, metaPath, PROVENANCE_SCHEMA, repoRoot, sha256 } from "./provenance.ts";

const COMMIT = /^[0-9a-f]{40}$/;

/** The bytes of `file` at `commit`, or undefined when it does not exist there. */
function blob(root: string, commit: string, file: string): Uint8Array | undefined {
  try {
    return execFileSync("git", ["show", `${commit}:${file}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/** Why the output's provenance does not hold, or undefined when it does. */
function checkOne(output: string, root: string, head: string): string | undefined {
  if (!existsSync(metaPath(output))) return `${output}: no sidecar ${metaPath(output)}`;
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metaPath(output), "utf8")) as Record<string, unknown>;
  } catch {
    return `${output}: the sidecar is not JSON`;
  }
  const { schema, commit, files, complete, outputSha256 } = meta;
  if (schema !== PROVENANCE_SCHEMA)
    return `${output}: the sidecar's schema is not ${PROVENANCE_SCHEMA}`;
  if (typeof commit !== "string" || !COMMIT.test(commit))
    return `${output}: the sidecar names no commit`;
  try {
    git(["cat-file", "-e", `${commit}^{commit}`], root);
  } catch {
    return `${output}: commit ${commit} is unknown`;
  }
  try {
    git(["merge-base", "--is-ancestor", commit, head], root);
  } catch {
    return `${output}: commit ${commit} is not HEAD or an ancestor of it`;
  }
  if (typeof files !== "object" || files === null || Object.keys(files).length === 0)
    return `${output}: the sidecar lists no file`;
  for (const [file, recorded] of Object.entries(files)) {
    for (const [at, name] of [
      [commit, `commit ${commit.slice(0, 10)}`],
      [head, "HEAD"],
    ] as const) {
      const bytes = blob(root, at, file);
      if (bytes === undefined) return `${output}: ${file} does not exist at ${name}`;
      if (sha256(bytes) !== recorded)
        return `${output}: ${file} at ${name} has sha256 ${sha256(bytes)}, the sidecar records ${String(recorded)}`;
    }
  }
  if (complete === true) {
    if (typeof outputSha256 !== "string") return `${output}: a complete output needs its sha256`;
    if (!existsSync(output)) return `${output}: the output is missing`;
    if (sha256(readFileSync(output)) !== outputSha256)
      return `${output}: the output's sha256 differs from the sidecar's`;
  }
  return undefined;
}

/** One failure per output whose provenance does not hold, checked in the repository at `root`. */
export function checkProvenance(outputs: readonly string[], root: string): string[] {
  const head = git(["rev-parse", "HEAD"], root);
  return outputs.flatMap((o) => checkOne(o, root, head) ?? []);
}

/** The outputs whose sidecars are committed, as paths from the repository root. */
export function committedOutputs(root: string): string[] {
  return git(["ls-files", "--", "*.meta.json"], root)
    .split("\n")
    .filter((f) => f !== "")
    .map((f) => f.replace(/\.meta\.json$/, ""))
    .toSorted();
}

if (import.meta.main) {
  const root = repoRoot(import.meta.filename);
  const args = process.argv.slice(2);
  const outputs = args.includes("--all") ? committedOutputs(root).map((o) => join(root, o)) : args;
  if (outputs.length === 0) throw new Error("usage: check-sweep-provenance.ts <output>... | --all");
  const failures = checkProvenance(outputs, root);
  for (const f of failures) console.error(f);
  if (failures.length > 0) process.exit(1);
  console.log(`provenance: ${outputs.length} output(s) match the scripts at HEAD`);
}
