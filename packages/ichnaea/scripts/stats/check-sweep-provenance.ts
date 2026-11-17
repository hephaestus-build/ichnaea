// Checks that each study output is current: that its sidecar (provenance.ts) still describes the
// code at HEAD. For each output:
//   - the sidecar has the schema ichnaea.stats-provenance/2; an older one needs a rerun;
//   - every pinned file has its recorded sha256 at the run commit and at HEAD;
//   - every pinned package is still in pnpm-lock.yaml at HEAD at its recorded version;
//   - the run's Node version is the one that the study workflows pin;
//   - a complete output still has the sha256 that the sidecar records;
//   - for a published output, the run commit is reachable from the head of the pull request that
//     the sidecar names (`pull`). The check fetches refs/pull/<N>/head from origin, since a plain
//     clone has no pull request refs.
// The run commit need not be an ancestor of HEAD: main merges by squash, so a pull request's
// commits never are. The pull request head keeps the run commit. A branch rebased or force-pushed
// after its study ran no longer holds that commit, and fails here before it merges.
// Every failure has one fix: rerun the study at the new commit, and commit what the run writes.
// Never edit a sidecar by hand. Lists every failing output, with every reason.
// Usage: node scripts/stats/check-sweep-provenance.ts <output>... | --all (every committed sidecar)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git, lockfileHolds, metaPath, PROVENANCE_SCHEMA, repoRoot, sha256 } from "./provenance.ts";

const COMMIT = /^[0-9a-f]{40}$/;
const RERUN = "rerun the study at the new commit; never edit the sidecar";

/** The workflows that run studies. Each pins the Node version of every published run. */
export const STUDY_WORKFLOWS = [
  ".github/workflows/calibration-rule-study.yml",
  ".github/workflows/confirmation-sweep.yml",
  ".github/workflows/stats-study.yml",
] as const;

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

/** The Node version that the study workflows pin at HEAD, or why there is not one. */
function pinnedNode(root: string): { readonly node: string } | { readonly problem: string } {
  const versions = new Set<string>();
  for (const workflow of STUDY_WORKFLOWS) {
    const text = blob(root, "HEAD", workflow);
    const pin = text && /\n {2}NODE_VERSION: "?([0-9.]+)"?\n/.exec(Buffer.from(text).toString());
    if (!pin?.[1]) return { problem: `${workflow} pins no NODE_VERSION at HEAD` };
    versions.add(`v${pin[1]}`);
  }
  if (versions.size > 1)
    return {
      problem: `the study workflows pin different Node versions: ${[...versions].join(", ")}`,
    };
  return { node: [...versions][0]! };
}

/** Context of one check: the repository, its pinned Node version, and the fetched pull heads. */
interface Context {
  readonly root: string;
  readonly node: ReturnType<typeof pinnedNode>;
  readonly lockfile: string;
  readonly remote: string;
  readonly published: boolean;
  readonly heads: Map<number, string | undefined>;
}

/** The head of pull request `n` as fetched from the remote now, or undefined when it cannot be. */
function pullHead(ctx: Context, n: number): string | undefined {
  if (!ctx.heads.has(n)) {
    const ref = `refs/remotes/${ctx.remote}/pull/${n}`;
    try {
      git(["fetch", "--quiet", "--no-tags", ctx.remote, `+refs/pull/${n}/head:${ref}`], ctx.root);
      ctx.heads.set(n, git(["rev-parse", ref], ctx.root));
    } catch {
      ctx.heads.set(n, undefined);
    }
  }
  return ctx.heads.get(n);
}

/** Why the output is not current, or nothing when it is. */
function checkOne(output: string, ctx: Context): string[] {
  const fail = (why: string): string[] => [`${output}: ${why}`];
  if (!existsSync(metaPath(output))) return fail(`no sidecar ${metaPath(output)}`);
  let meta: Record<string, unknown>;
  try {
    meta = Object(JSON.parse(readFileSync(metaPath(output), "utf8"))) as Record<string, unknown>;
  } catch {
    return fail("the sidecar is not JSON");
  }
  const { schema, commit, pull, files, packages, node, complete, outputSha256 } = meta;
  if (schema !== PROVENANCE_SCHEMA)
    return fail(`the sidecar's schema is ${String(schema)}, not ${PROVENANCE_SCHEMA}; ${RERUN}`);
  if (typeof commit !== "string" || !COMMIT.test(commit))
    return fail("the sidecar names no commit");
  if (ctx.published) {
    if (typeof pull !== "number" || !Number.isInteger(pull) || pull < 1)
      return fail("the sidecar names no pull request; record the PR number: rerun with --pull");
    const head = pullHead(ctx, pull);
    if (head === undefined) return fail(`cannot fetch refs/pull/${pull}/head from ${ctx.remote}`);
    try {
      git(["merge-base", "--is-ancestor", commit, head], ctx.root);
    } catch {
      return fail(
        `commit ${commit} is not reachable from refs/pull/${pull}/head (${head.slice(0, 10)}): ` +
          `the branch was rebased or force-pushed after the study ran; ${RERUN}`,
      );
    }
  } else {
    try {
      git(["cat-file", "-e", `${commit}^{commit}`], ctx.root);
    } catch {
      return fail(`commit ${commit} is unknown`);
    }
  }
  if (typeof files !== "object" || files === null || Object.keys(files).length === 0)
    return fail("the sidecar lists no file");
  if (!Array.isArray(packages)) return fail("the sidecar lists no packages");

  const problems: string[] = [];
  for (const [file, recorded] of Object.entries(files)) {
    for (const [at, name] of [
      [commit, `commit ${commit.slice(0, 10)}`],
      ["HEAD", "HEAD"],
    ] as const) {
      const bytes = blob(ctx.root, at, file);
      if (bytes === undefined) problems.push(`${file} does not exist at ${name}; ${RERUN}`);
      else if (sha256(bytes) !== recorded)
        problems.push(
          `${file} at ${name} has sha256 ${sha256(bytes)}, the sidecar records ${String(recorded)}; ${RERUN}`,
        );
    }
  }
  for (const pkg of packages)
    if (typeof pkg !== "string" || !lockfileHolds(ctx.lockfile, pkg))
      problems.push(`${String(pkg)} is not in pnpm-lock.yaml at HEAD; ${RERUN}`);
  if ("problem" in ctx.node) problems.push(ctx.node.problem);
  else if (node !== ctx.node.node)
    problems.push(
      `the run ran on Node ${String(node)}, the study workflows pin ${ctx.node.node}; ${RERUN}`,
    );
  if (complete === true) {
    if (typeof outputSha256 !== "string") problems.push("a complete output needs its sha256");
    else if (!existsSync(output)) problems.push("the output is missing");
    else if (sha256(readFileSync(output)) !== outputSha256)
      problems.push("the output's sha256 differs from the sidecar's");
  }
  return problems.map((p) => `${output}: ${p}`);
}

/**
 * Every reason why an output is not current, checked in the repository at `root`. A published
 * output (the default) must name the pull request whose head, fetched from `remote`, holds its run
 * commit. An output of a run that publishes nothing, such as a sweep's artifact, needs only a run
 * commit that exists here.
 */
export function checkProvenance(
  outputs: readonly string[],
  root: string,
  options: { readonly published?: boolean; readonly remote?: string } = {},
): string[] {
  const lockfile = blob(root, "HEAD", "pnpm-lock.yaml");
  const ctx: Context = {
    root,
    node: pinnedNode(root),
    lockfile: lockfile === undefined ? "" : Buffer.from(lockfile).toString(),
    remote: options.remote ?? "origin",
    published: options.published ?? true,
    heads: new Map(),
  };
  return outputs.flatMap((o) => checkOne(o, ctx));
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
  console.log(`provenance: ${outputs.length} output(s) are current at HEAD`);
}
