// Writes the release notes of a GitHub release: how to install the version from npm, how to verify
// it, and the conventional commit titles since the previous v* tag, which are the change log.
// Usage: node scripts/release-notes.ts <tag> [<commit>] > notes.md
// The commit is HEAD by default. The checkout needs every tag and the history (`fetch-depth: 0`).
import { execFileSync } from "node:child_process";

import { distTag, previousTag, releaseTags, tagProblem } from "./check-release-tag.ts";
import { PACKAGE_NAME, workspaceZod } from "./readme-example.ts";

/** The file that `pnpm pack` writes for a version of the package, and the release's asset name. */
export const tarballName = (version: string): string => `tumaet-ichnaea-${version}.tgz`;

/**
 * How a consumer verifies what it installed. `npm audit signatures` checks the registry's
 * signature of every installed package and the provenance attestation of each package that has
 * one. The provenance names the workflow run that staged the version.
 */
export const VERIFY = `\`\`\`sh
# In your project, after the install: the registry signatures and the provenance attestations
npm audit signatures
# The files of this release that you downloaded
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

/** What the notes of one release say besides its tag. */
export interface NotesInput {
  /** The zod version that the release was tested with. */
  readonly zod: string;
  /** The previous release's tag, or undefined for the first release. */
  readonly previous: string | undefined;
  /** The commit titles since the previous release, newest first. */
  readonly titles: readonly string[];
}

/** The notes of the GitHub release of `tag`, in Markdown. */
export function releaseNotes(tag: string, { zod, previous, titles }: NotesInput): string {
  const version = tag.slice(1);
  return `Release ${tag} of \`${PACKAGE_NAME}\` on npm, with the dist-tag ${distTag(tag)}.

## Install

\`\`\`sh
pnpm add ${PACKAGE_NAME}@${version} zod@${zod}
\`\`\`

Your lockfile records the tarball's integrity hash. Run the CLI with Node 24.3 or later:
\`pnpm exec ichnaea <command>\`.

## Verify

${VERIFY}

The provenance on npm names the run of
\`hephaestus-build/ichnaea/.github/workflows/release.yml\` that staged this version from the tag
${tag}. A package owner approved the staged version on npm. This release holds the same tarball,
\`${tarballName(version)}\`, its SBOM \`sbom.cdx.json\` and \`SHA256SUMS\`. The SBOM lists the
package and zod, its peer dependency, at the version that the release was tested with.

${previous === undefined ? "## Changes\n\nThe first release. Every change on main up to it:" : `## Changes since ${previous}`}

${changes(titles)}
`;
}

if (import.meta.main) {
  const [tag = "", head = "HEAD"] = process.argv.slice(2);
  // Only the tag's form: a later release may have been tagged before this one was finished.
  const why = tagProblem(tag, []);
  if (why) throw new Error(why);
  const previous = previousTag(tag, releaseTags());
  process.stdout.write(
    releaseNotes(tag, { zod: workspaceZod(), previous, titles: commitTitles(previous, head) }),
  );
}
