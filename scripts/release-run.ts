// Finds the run of release.yml that staged a release tag, whose artifact holds the staged files.
// A branch may have the tag's name, so the run is chosen by the tag's commit and the push event,
// never by the branch name alone: a branch with a changed release.yml has another commit.
// Usage: node scripts/release-run.ts <tag> >> "$GITHUB_OUTPUT"
// Run it from a checkout of main with every tag. It prints `run=<id>` and `commit=<sha>`, and
// needs `gh` with a token that reads the repository's workflow runs.
import { execFileSync } from "node:child_process";

import { tagProblem } from "./check-release-tag.ts";

const WORKFLOW = ".github/workflows/release.yml";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/**
 * The id of the one successful push run of release.yml for `tag` at its commit, from an answer of
 * `GET /repos/{owner}/{repo}/actions/workflows/release.yml/runs`. None, or more than one, is an
 * error.
 */
export function releaseRun(
  answer: unknown,
  { tag, commit }: { readonly tag: string; readonly commit: string },
): number {
  const runs = field(answer, "workflow_runs");
  if (!Array.isArray(runs)) throw new Error("the GitHub API gave no list of workflow runs");
  const ids = runs
    .filter(
      (r) =>
        field(r, "event") === "push" &&
        field(r, "head_sha") === commit &&
        field(r, "head_branch") === tag &&
        field(r, "path") === WORKFLOW &&
        field(r, "conclusion") === "success",
    )
    .map((r) => field(r, "id"))
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0)
    throw new Error(`no successful push run of ${WORKFLOW} for ${tag} at ${commit}`);
  if (ids.length > 1)
    throw new Error(
      `${ids.length} successful push runs of ${WORKFLOW} for ${tag}: ${ids.join(", ")}`,
    );
  return ids[0]!;
}

if (import.meta.main) {
  const [tag = ""] = process.argv.slice(2);
  const why = tagProblem(tag, []);
  if (why) throw new Error(why);
  const commit = execFileSync("git", ["rev-parse", `refs/tags/${tag}^{commit}`], {
    encoding: "utf8",
  }).trim();
  const answer = execFileSync(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/actions/workflows/release.yml/runs?event=push&head_sha=${commit}&status=success&per_page=100`,
    ],
    { encoding: "utf8" },
  );
  const run = releaseRun(JSON.parse(answer) as unknown, { tag, commit });
  console.error(`release run of ${tag} at ${commit}: ${run}`);
  console.log(`run=${run}\ncommit=${commit}`);
}
