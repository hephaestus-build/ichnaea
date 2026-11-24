// Fails unless a pushed release tag is a 0.x pre-release greater than every other version tag
// in the 0.x line, so that releases only move forward. A
// breaking change since the last tag needs a minor bump over the last release. The tag exists
// already, because pushing it starts the release workflow. Every tag and the history are read with
// git, so the checkout needs them all (`fetch-depth: 0`).
// Usage: node scripts/check-release-tag.ts <tag> [<commit>] >> "$GITHUB_OUTPUT"
// The commit is HEAD by default. On success it prints the version for the workflow.
import { execFileSync } from "node:child_process";

import { RELEASE_VERSION } from "./release-version.ts";

/** A tag `v<version>`, a {@link RELEASE_VERSION}. */
const VERSION_TAG = new RegExp(`^v${RELEASE_VERSION.source.slice(1)}`);

interface Parsed {
  readonly core: readonly [number, number, number];
  readonly pre: readonly string[];
}

const parse = (tag: string): Parsed => {
  const match = VERSION_TAG.exec(tag);
  if (!match) throw new Error(`${tag} is not a version tag`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
};

/** Orders two pre-release identifiers as semver does: numbers by value, and below any word. */
const compareIdentifiers = (a: string, b: string): number => {
  const [x, y] = [/^\d+$/.test(a), /^\d+$/.test(b)];
  if (x && y) return Number(a) - Number(b);
  if (x !== y) return x ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Orders two version tags by semver precedence. A pre-release comes before its release. */
export function compareTags(a: string, b: string): number {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i += 1) {
    const order = compareIdentifiers(x.pre[i]!, y.pre[i]!);
    if (order !== 0) return order;
  }
  return x.pre.length - y.pre.length;
}

/** The v* tags of the repository. */
export function releaseTags(cwd = process.cwd()): string[] {
  return execFileSync("git", ["tag", "--list", "v*"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((t) => t !== "");
}

/** Whether a tag is a version of the 0.x release line. */
const inLine = (tag: string): boolean => VERSION_TAG.test(tag) && parse(tag).core[0] === 0;

/**
 * Splits v* tags into the release line, the versions with major 0, and the tags that it ignores:
 * a typo such as `vnext`, or a version of another major such as `v1.0.0`. A tag that nobody may
 * delete then cannot block every later release.
 */
export function releaseLine(tags: readonly string[]): { line: string[]; ignored: string[] } {
  return { line: tags.filter(inLine), ignored: tags.filter((t) => !inLine(t)) };
}

/** The greatest tag of the release line: the previous release or pre-release. */
export function latestTag(tags: readonly string[]): string | undefined {
  return releaseLine(tags).line.toSorted(compareTags).at(-1);
}

/**
 * The greatest version tag below `tag`: the release that `tag` follows, even when a later release
 * was tagged before `tag` was finished.
 */
export function previousTag(tag: string, tags: readonly string[]): string | undefined {
  return latestTag(releaseLine(tags).line.filter((t) => compareTags(t, tag) < 0));
}

/** The npm dist-tag of a release: `next` for a pre-release, so that it never becomes `latest`. */
export const distTag = (tag: string): "latest" | "next" =>
  parse(tag).pre.length > 0 ? "next" : "latest";

/**
 * Returns why `tag` may not be released after the other v* tags, or nothing if it may. Only the
 * release line counts: {@link releaseLine} ignores the other tags.
 */
export function tagProblem(tag: string, others: readonly string[]): string | undefined {
  if (releaseLine([tag]).line.length === 0)
    return `release tag ${tag} is not v0.<minor>.<patch>[-<pre-release>]`;
  const latest = latestTag(others);
  if (latest !== undefined && compareTags(tag, latest) <= 0)
    return `release tag ${tag} is not greater than ${latest}, the greatest other v* tag`;
  return undefined;
}

/** Whether a conventional commit message marks a breaking change: `type!:`, or a footer. */
export const isBreaking = (message: string): boolean =>
  /^\w+(?:\([^)]*\))?!:/.test(message) || /^BREAKING[ -]CHANGE:/m.test(message);

/**
 * Returns why `tag` may not carry the breaking changes among `messages`, or nothing if it may. In
 * 0.x, a breaking change needs a minor version above the greatest other version tag, including
 * pre-releases. Before the first version, nothing is needed.
 */
export function breakingProblem(
  tag: string,
  others: readonly string[],
  messages: readonly string[],
): string | undefined {
  const breaking = messages.find(isBreaking);
  const previous = latestTag(others);
  if (breaking === undefined || previous === undefined) return undefined;
  const [, minor] = parse(previous).core;
  if (parse(tag).core[1] > minor) return undefined;
  return (
    `${breaking.split("\n")[0]} is a breaking change since ${previous}, ` +
    `so ${tag} must raise the minor version, to v0.${minor + 1}.0 or later`
  );
}

/** The full messages of the commits after `previous` up to `head`, newest first. */
export function commitMessages(
  previous: string | undefined,
  head = "HEAD",
  cwd = process.cwd(),
): string[] {
  const range = previous === undefined ? head : `${previous}..${head}`;
  return execFileSync("git", ["log", "--format=%B%x00", range], { cwd, encoding: "utf8" })
    .split("\0")
    .map((m) => m.trim())
    .filter((m) => m !== "");
}

if (import.meta.main) {
  const [tag = "", head = "HEAD"] = process.argv.slice(2);
  const others = releaseTags().filter((t) => t !== tag);
  const { ignored } = releaseLine(others);
  if (ignored.length > 0)
    console.error(`ignored: the v* tags ${ignored.join(", ")} are not versions of the 0.x line`);
  const previous = latestTag(others);
  const why =
    tagProblem(tag, others) ??
    (distTag(tag) === "next" ? undefined : `release tag ${tag} must be a 0.x pre-release`) ??
    breakingProblem(tag, others, commitMessages(previous, head));
  if (why) {
    console.error(why);
    process.exit(1);
  }
  console.error(`release tag ${tag} follows ${previous ?? "no release"}`);
  console.log(`version=${tag.slice(1)}`);
}
