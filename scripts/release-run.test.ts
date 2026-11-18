import { describe, expect, it } from "vitest";

import { releaseRun } from "./release-run.ts";

const commit = "0123456789abcdef0123456789abcdef01234567";
const run = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  event: "push",
  head_branch: "v0.2.0",
  head_sha: commit,
  path: ".github/workflows/release.yml",
  status: "completed",
  conclusion: "success",
  ...overrides,
});
const tag = { tag: "v0.2.0", commit };

describe("the release run of a tag", () => {
  it("is the successful push run of release.yml on the tag's commit", () => {
    expect(releaseRun({ workflow_runs: [run()] }, tag)).toBe(41);
  });

  it("is never a run of a branch with the tag's name, which has another commit", () => {
    // A branch named v0.2.0 with a changed release.yml: same head branch, another commit.
    const branch = run({ id: 99, head_sha: "f".repeat(40) });
    expect(releaseRun({ workflow_runs: [branch, run()] }, tag)).toBe(41);
    expect(() => releaseRun({ workflow_runs: [branch] }, tag)).toThrow(
      `no successful push run of .github/workflows/release.yml for v0.2.0 at ${commit}`,
    );
  });

  it("is never a run of another workflow, another event, or one that failed", () => {
    for (const other of [
      run({ path: ".github/workflows/other.yml" }),
      run({ event: "workflow_dispatch" }),
      run({ conclusion: "failure" }),
      run({ head_branch: "main" }),
    ])
      expect(() => releaseRun({ workflow_runs: [other] }, tag)).toThrow(/no successful push run/);
  });

  it("is refused when two runs qualify, because the tag's files would be ambiguous", () => {
    expect(() => releaseRun({ workflow_runs: [run(), run({ id: 42 })] }, tag)).toThrow(
      "2 successful push runs of .github/workflows/release.yml for v0.2.0: 41, 42",
    );
  });

  it("refuses an answer of the API that is not a list of runs", () => {
    expect(() => releaseRun({ message: "Not Found" }, tag)).toThrow(
      "the GitHub API gave no list of workflow runs",
    );
  });
});
