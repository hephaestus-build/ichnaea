// Finds the release tags that release-finish.yml finishes: each v* tag whose version a package
// owner approved on npm, so that npm lists it as published, and that has no GitHub release yet. A
// version that is only staged is not listed by npm, so it waits. Given a tag, it finishes that
// tag alone, and fails if its version is not published.
// Usage: node scripts/release-pending.ts [<tag>] >> "$GITHUB_OUTPUT"
// It prints `tags=<JSON list>`, oldest first. It needs `gh` with a token that reads the releases.
import { execFileSync, spawnSync } from "node:child_process";

import { compareTags, releaseTags, tagProblem } from "./check-release-tag.ts";
import { PACKAGE_NAME } from "./readme-example.ts";

/** What release-finish.yml knows when it starts. */
export interface PendingInput {
  /** Every tag of the repository that starts with `v`. */
  readonly tags: readonly string[];
  /** The versions that npm lists as published. */
  readonly published: ReadonlySet<string>;
  /** The tags that have a GitHub release. */
  readonly released: ReadonlySet<string>;
  /** The tag that a person asked to finish, if any. */
  readonly requested?: string;
}

/** The tags to finish, oldest first. A requested tag that cannot be finished is an error. */
export function pendingTags({ tags, published, released, requested }: PendingInput): string[] {
  if (requested !== undefined) {
    const why = tagProblem(requested, []);
    if (why) throw new Error(why);
    if (!tags.includes(requested)) throw new Error(`the tag ${requested} does not exist`);
    if (released.has(requested)) return [];
    if (!published.has(requested.slice(1)))
      throw new Error(
        `${requested.slice(1)} is not published on npm: approve the staged version on npmjs.com first`,
      );
    return [requested];
  }
  return tags
    .filter((t) => tagProblem(t, []) === undefined)
    .filter((t) => published.has(t.slice(1)) && !released.has(t))
    .toSorted(compareTags);
}

/** The answer of `npm view <package> versions --json`. */
export interface NpmView {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The published versions in an answer of npm view. A package that is not on npm has none. */
export function publishedVersions({ status, stdout, stderr }: NpmView): Set<string> {
  if (status !== 0) {
    if (/\bE404\b/.test(stderr)) return new Set();
    throw new Error(`npm view failed: ${stderr.trim()}`);
  }
  const versions: unknown = JSON.parse(stdout);
  const list = typeof versions === "string" ? [versions] : versions;
  if (!Array.isArray(list) || !list.every((v) => typeof v === "string"))
    throw new Error("npm view gave no version list");
  return new Set(list);
}

if (import.meta.main) {
  const requested = process.argv[2] || undefined;
  const view = spawnSync("npm", ["view", PACKAGE_NAME, "versions", "--json"], {
    encoding: "utf8",
  });
  const released = execFileSync(
    "gh",
    ["release", "list", "--limit", "1000", "--json", "tagName", "--jq", ".[].tagName"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((t) => t !== "");
  const tags = pendingTags({
    tags: releaseTags(),
    published: publishedVersions(view),
    released: new Set(released),
    ...(requested === undefined ? {} : { requested }),
  });
  console.error(tags.length === 0 ? "no release is pending" : `pending: ${tags.join(", ")}`);
  console.log(`tags=${JSON.stringify(tags)}`);
}
