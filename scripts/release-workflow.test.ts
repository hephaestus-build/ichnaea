// Releases are paused: the build job fails before it checks anything out, so no run reaches the
// release job. The order of the release job: it checks the deploy key before it attests, tags or
// publishes anything. The workflow is read as text, by its indentation: a job is a key at two spaces under
// `jobs:`, a step an item at six.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(import.meta.dirname, "..", ".github", "workflows", "release.yml"),
  "utf8",
);
const jobs = new Map(
  (workflow.split("\njobs:\n")[1] ?? "")
    .split(/\n(?= {2}[\w-]+:\n)/)
    .map((job) => [job.trim().split(":")[0] ?? "", job]),
);
const steps = (job: string): string[] => (jobs.get(job) ?? "").split(/\n {6}- /).slice(1);

describe("release workflow", () => {
  it("fails in the build job's first step while releases are paused, and says why", () => {
    const [first] = steps("build");
    expect(first).toContain("name: Releases are paused");
    expect(first).toContain("Releases are paused: consumers pin a commit.");
    expect(first).toMatch(/\n {10}exit 1$/m);
    expect(first).not.toMatch(/\bif:/);
    // Every other job runs only after the build job.
    for (const [name, text] of jobs)
      if (name !== "build") expect(text, name).toMatch(/\n {4}needs: build\n/);
  });

  it("has the release environment only in the job that attests, tags and publishes", () => {
    const withEnvironment = [...jobs].filter(([, text]) =>
      /\n {4}environment: release\n/.test(text),
    );
    expect(withEnvironment.map(([name]) => name)).toEqual(["release"]);
    for (const [name, text] of jobs)
      if (name !== "release")
        expect(text, name).not.toMatch(/actions\/attest@|git push|gh release create/);
  });

  it("checks for the deploy key in the release job's first step", () => {
    const [first, ...rest] = steps("release");
    expect(first).toContain("name: The release environment has the deploy key");
    expect(first).toContain("HAS_DEPLOY_KEY: ${{ secrets.RELEASE_DEPLOY_KEY != '' }}");
    expect(first).toContain('if [ "$HAS_DEPLOY_KEY" != true ]; then');
    expect(rest.join("\n")).toMatch(/actions\/attest@/);
    expect(rest.join("\n")).toContain("ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}");
  });
});
