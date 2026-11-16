// Writes the release notes: how to install the tarball from the release, how to verify it, and the
// conventional commit titles on main since the previous release, which are the change log.
// Usage: node scripts/release-notes.ts <tag> [<commit>] > notes.md
// The commit is HEAD by default. The checkout needs every tag and the history (`fetch-depth: 0`).
import { execFileSync } from "node:child_process";

import { latestTag, releaseTags } from "./check-release-tag.ts";
import { PACKAGE_NAME, workspaceZod } from "./readme-example.ts";

/** The file that `pnpm pack` writes for a version of the package, and the release's asset name. */
export const tarballName = (version: string): string => `hephaestus-build-ichnaea-${version}.tgz`;

/** The URL that a consumer downloads a file of the release from. */
export const downloadUrl = (tag: string, file: string): string =>
  `https://github.com/hephaestus-build/ichnaea/releases/download/${tag}/${file}`;

/**
 * How a consumer verifies a downloaded tarball. Only the release workflow, run on main, signs an
 * attestation that passes: `--signer-workflow` alone accepts that workflow on any ref.
 */
export const verify = (tarball: string): string => `\`\`\`sh
# Build provenance: built by the release workflow from main, on a GitHub-hosted runner
gh attestation verify ${tarball} --repo hephaestus-build/ichnaea \\
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \\
  --source-ref refs/heads/main --deny-self-hosted-runners
# The SBOM (CycloneDX) attested for the same tarball
gh attestation verify ${tarball} --repo hephaestus-build/ichnaea \\
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \\
  --source-ref refs/heads/main --deny-self-hosted-runners \\
  --predicate-type https://cyclonedx.org/bom
# The checksums of the files that you downloaded
sha256sum --check --ignore-missing SHA256SUMS
\`\`\``;

const GROUPS = [
  { heading: "Features", type: /^feat[(!:]/ },
  { heading: "Fixes", type: /^fix[(!:]/ },
  { heading: "Other changes", type: /^/ },
] as const;

/** The commit titles, grouped by their conventional commit type, in the order given. */
export function changes(titles: readonly string[]): string {
  if (titles.length === 0) return "No commits since the previous release.";
  const left = [...titles];
  return GROUPS.flatMap(({ heading, type }) => {
    const mine = left.filter((t) => type.test(t));
    for (const t of mine) left.splice(left.indexOf(t), 1);
    return mine.length === 0 ? [] : [`### ${heading}\n\n${mine.map((t) => `- ${t}`).join("\n")}`];
  }).join("\n\n");
}

/** The titles of the commits after `previous` up to `head`, newest first: all of them without one. */
export function commitTitles(
  previous: string | undefined,
  head = "HEAD",
  cwd = process.cwd(),
): string[] {
  const range = previous === undefined ? head : `${previous}..${head}`;
  return execFileSync("git", ["log", "--format=%s", range], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((t) => t !== "");
}

export interface NotesInput {
  /** The zod version that the release was tested with. */
  readonly zod: string;
  /** The previous release's tag, or undefined for the first release. */
  readonly previous: string | undefined;
  /** The commit titles since the previous release, newest first. */
  readonly titles: readonly string[];
}

export function releaseNotes(tag: string, { zod, previous, titles }: NotesInput): string {
  const tarball = tarballName(tag.replace(/^v/, ""));
  return `Release ${tag} of \`${PACKAGE_NAME}\`. It is not on npm.

## Install

\`\`\`sh
pnpm add zod@${zod} "${downloadUrl(tag, tarball)}"
\`\`\`

Your lockfile records the tarball's integrity hash. Run the CLI with Node 24.3 or later:
\`pnpm exec ichnaea <command>\`.

## Verify

Verify the tarball before you install it:

${verify(tarball)}

The release is immutable: its tag and its files cannot change. \`sbom.cdx.json\` lists the package
and zod, its peer dependency, at the version that the release was tested with.

${previous === undefined ? "## Changes\n\nThe first release. Every change on main up to it:" : `## Changes since ${previous}`}

${changes(titles)}
`;
}

if (import.meta.main) {
  const [tag = "", head = "HEAD"] = process.argv.slice(2);
  if (!/^v0\.\d+\.\d+$/.test(tag)) throw new Error(`release tag ${tag} is not v0.x.y`);
  const previous = latestTag(releaseTags().filter((t) => t !== tag));
  process.stdout.write(
    releaseNotes(tag, { zod: workspaceZod(), previous, titles: commitTitles(previous, head) }),
  );
}
