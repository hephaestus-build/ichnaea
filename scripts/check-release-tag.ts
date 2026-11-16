// Fails unless a release tag is v0.<minor>.<patch>, is not a tag yet, and is greater than every
// existing v* tag, so that releases only move forward. It reads the tags with `git tag`, not with
// the GitHub API, so the checkout must have every tag (`fetch-depth: 0`).
// Usage: node scripts/check-release-tag.ts <tag>
import { execFileSync } from "node:child_process";

const RELEASE_TAG = /^v0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The major, minor and patch numbers of a `v<major>.<minor>.<patch>` tag. */
const parts = (tag: string): number[] => tag.slice(1).split(".").map(Number);

/** Orders two `v<major>.<minor>.<patch>` tags by their numbers. */
export function compareTags(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** The v* tags of the repository. */
export function releaseTags(cwd = process.cwd()): string[] {
  return execFileSync("git", ["tag", "--list", "v*"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((t) => t !== "");
}

/** The greatest of the v* tags, all `v<major>.<minor>.<patch>`: the previous release. */
export function latestTag(tags: readonly string[]): string | undefined {
  return tags.toSorted(compareTags).at(-1);
}

/** Returns why `tag` may not be released after the existing v* tags, or nothing if it may. */
export function tagProblem(tag: string, existing: readonly string[]): string | undefined {
  if (!RELEASE_TAG.test(tag)) return `release tag ${tag} is not v0.<minor>.<patch>`;
  if (existing.includes(tag)) return `tag ${tag} exists already`;
  const others = existing.filter((t) => !VERSION_TAG.test(t));
  if (others.length > 0)
    return `the v* tags ${others.join(", ")} are not v<major>.<minor>.<patch>, so no release can be ordered after them`;
  const latest = latestTag(existing);
  if (latest !== undefined && compareTags(tag, latest) <= 0)
    return `release tag ${tag} is not greater than ${latest}, the greatest v* tag`;
  return undefined;
}

if (import.meta.main) {
  const tag = process.argv[2] ?? "";
  const tags = releaseTags();
  const why = tagProblem(tag, tags);
  if (why) {
    console.error(why);
    process.exit(1);
  }
  console.log(`release tag ${tag} follows ${latestTag(tags) ?? "no release"}`);
}
