// Verifies a version that a package owner approved on npm, as a consumer would see it:
// - the registry's integrity of the version is the SHA-512 that the release workflow staged;
// - a new npm project installs the version with zod, and `npm audit signatures` finds every
//   registry signature valid and the provenance of the version;
// - that provenance names this repository's `.github/workflows/release.yml` at the release tag,
//   on a GitHub-hosted runner, for the staged tarball, built from the tag's commit;
// - the tag's commit is reachable from main;
// - the installed bin prints the version.
// Usage: node scripts/verify-published.ts <tag> <staged integrity, sha512-…>
// Run it from a checkout of main with every tag and the history (`fetch-depth: 0`), never from the
// tag: the finish workflow runs no code of the version that it checks.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { notOnMain } from "./check-on-main.ts";
import { tagProblem } from "./check-release-tag.ts";
import { PACKAGE_NAME, workspaceZod } from "./readme-example.ts";

const REPOSITORY = "https://github.com/hephaestus-build/ichnaea";
const WORKFLOW = ".github/workflows/release.yml";
const SLSA = "https://slsa.dev/provenance/v1";
const HOSTED = "https://github.com/actions/runner/github-hosted";

/** The hex SHA-512 of an npm integrity, `sha512-<base64>`. */
export function sha512Hex(integrity: string): string {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity))
    throw new Error(`${integrity} is not a sha512 integrity`);
  return Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex");
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((v, key) => record(v)[key], value);

/** A package that npm audit signatures lists, by name and version. */
const named = (p: unknown): string => `${String(at(p, "name"))}@${String(at(p, "version"))}`;

/** The SLSA provenance statement of the package's `version` among an audit's verified packages. */
function slsaStatement(verified: readonly unknown[], version: string): unknown {
  const own = verified.find((p) => named(p) === `${PACKAGE_NAME}@${version}`);
  const bundles = at(own, "attestationBundles");
  return (Array.isArray(bundles) ? bundles : [])
    .filter((b) => at(b, "predicateType") === SLSA)
    .map((b) => {
      const payload = at(b, "bundle", "dsseEnvelope", "payload");
      return typeof payload === "string"
        ? (JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as unknown)
        : undefined;
    })
    .find((s) => at(s, "predicateType") === SLSA);
}

/**
 * Whether the output of `npm audit signatures --json --include-attestations` lists the package's
 * `version` as verified with an SLSA provenance. The consumer test checks it in pnpm's layout.
 */
export function hasProvenance(audit: unknown, version: string): boolean {
  const verified = at(audit, "verified");
  return Array.isArray(verified) && slsaStatement(verified, version) !== undefined;
}

/**
 * Returns one problem per way in which the output of `npm audit signatures --json
 * --include-attestations` does not show the release's provenance. npm has checked the signatures;
 * this reads what they sign. The output crosses a trust boundary, so every field is checked.
 */
export function provenanceProblems(
  audit: unknown,
  expected: { readonly tag: string; readonly sha512: string; readonly commit: string },
): string[] {
  const version = expected.tag.slice(1);
  const problems: string[] = [];
  for (const kind of ["invalid", "missing"] as const) {
    const list = at(audit, kind);
    if (!Array.isArray(list)) problems.push(`npm audit signatures gave no ${kind} list`);
    else
      for (const p of list)
        problems.push(
          `npm audit signatures found ${kind === "invalid" ? "an invalid" : "a missing"} signature: ${named(p)}`,
        );
  }
  const verified = at(audit, "verified");
  if (!Array.isArray(verified)) return ["npm audit signatures gave no list of verified packages"];
  if (problems.length > 0) return problems;
  const statement = slsaStatement(verified, version);
  if (statement === undefined)
    return [`npm audit signatures shows no provenance for ${PACKAGE_NAME}@${version}`];
  const subject = at(statement, "subject");
  const purl = `pkg:npm/${PACKAGE_NAME.replaceAll("@", "%40")}@${version}`;
  if (
    !Array.isArray(subject) ||
    !subject.some((s) => at(s, "name") === purl && at(s, "digest", "sha512") === expected.sha512)
  )
    problems.push(`the provenance's subject is not ${purl} with the staged SHA-512`);
  const workflow = at(statement, "predicate", "buildDefinition", "externalParameters", "workflow");
  const want = `${REPOSITORY} ${WORKFLOW} at refs/tags/${expected.tag}`;
  const have = `${String(at(workflow, "repository"))} ${String(at(workflow, "path"))} at ${String(at(workflow, "ref"))}`;
  if (have !== want) problems.push(`the provenance names the workflow ${have}, not ${want}`);
  // The source that the workflow checked out: the tag's ref and the commit that it named.
  const dependencies = at(statement, "predicate", "buildDefinition", "resolvedDependencies");
  const source = (Array.isArray(dependencies) ? dependencies : []).find(
    (d) => at(d, "uri") === `git+${REPOSITORY}@refs/tags/${expected.tag}`,
  );
  const gitCommit = at(source, "digest", "gitCommit");
  if (gitCommit !== expected.commit)
    problems.push(
      `the provenance names the source ${typeof gitCommit === "string" ? gitCommit : "none"}, ` +
        `not ${expected.commit}, the commit of ${expected.tag}`,
    );
  const builder = at(statement, "predicate", "runDetails", "builder", "id");
  if (builder !== HOSTED)
    problems.push(`the provenance names the builder ${String(builder)}, not ${HOSTED}`);
  return problems;
}

if (import.meta.main) {
  const [tag = "", staged = ""] = process.argv.slice(2);
  const why = tagProblem(tag, []);
  if (why) throw new Error(why);
  const version = tag.slice(1);
  const spec = `${PACKAGE_NAME}@${version}`;
  const commit = execFileSync("git", ["rev-parse", `refs/tags/${tag}^{commit}`], {
    encoding: "utf8",
  }).trim();
  const off = notOnMain(`refs/tags/${tag}`, commit);
  if (off) throw new Error(off);
  console.log(`published: ${tag} names ${commit}, which is reachable from main`);
  const registry = execFileSync("npm", ["view", spec, "dist.integrity"], { encoding: "utf8" });
  if (registry.trim() !== staged)
    throw new Error(
      `npm serves ${spec} with integrity ${registry.trim()}, not the staged ${staged}`,
    );
  console.log(`published: npm serves ${spec} with the staged integrity`);
  const project = mkdtempSync(join(tmpdir(), "ichnaea-published-"));
  try {
    writeFileSync(join(project, "package.json"), '{ "private": true, "type": "module" }\n');
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", spec, `zod@${workspaceZod()}`],
      { cwd: project, stdio: "inherit" },
    );
    const audit = spawnSync("npm", ["audit", "signatures", "--json", "--include-attestations"], {
      cwd: project,
      encoding: "utf8",
    });
    const problems = provenanceProblems(JSON.parse(audit.stdout) as unknown, {
      tag,
      sha512: sha512Hex(staged),
      commit,
    });
    if (audit.status !== 0 && problems.length === 0)
      problems.push(`npm audit signatures exited with ${audit.status}: ${audit.stderr.trim()}`);
    if (problems.length > 0)
      throw new Error(`the published version is wrong:\n${problems.join("\n")}`);
    console.log(
      `published: the signatures are valid, and the provenance names ${WORKFLOW} at ${tag}`,
    );
    const printed = execFileSync(join(project, "node_modules", ".bin", "ichnaea"), ["--version"], {
      cwd: project,
      encoding: "utf8",
    }).trim();
    if (printed !== version)
      throw new Error(`ichnaea --version printed ${printed}, not ${version}`);
    console.log(`published: ichnaea --version prints ${printed}`);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
