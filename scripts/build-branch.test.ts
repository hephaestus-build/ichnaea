// The build branch workflow and its rulesets, read as text and JSON. Only the publish job of
// build-branch.yml holds the deploy key, it runs no repository code, and it can only append to
// `build`. A job is a key at two spaces under `jobs:`, a step an item at six.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceCommitOf, toolProblems } from "./verify-build.ts";

const github = join(import.meta.dirname, "..", ".github");
const read = (...path: string[]): string => readFileSync(join(github, ...path), "utf8");
const workflow = read("workflows", "build-branch.yml");
const jobs = new Map(
  (workflow.split("\njobs:\n")[1] ?? "")
    .split(/\n(?= {2}[\w-]+:\n)/)
    .map((job) => [job.trim().split(":")[0] ?? "", job]),
);
const job = (name: string): string => jobs.get(name) ?? "";
const steps = (name: string): string[] =>
  job(name)
    .split(/\n {6}- /)
    .slice(1);
const ruleset = (file: string): Record<string, unknown> =>
  JSON.parse(read("rulesets", file)) as Record<string, unknown>;

/** The SHA-256 fingerprint of an OpenSSH public key, as `ssh-keygen -l` prints it. */
const fingerprint = (key: string): string =>
  `SHA256:${createHash("sha256")
    .update(Buffer.from(key, "base64"))
    .digest("base64")
    .replace(/=+$/, "")}`;

describe("the build branch workflow", () => {
  it("runs on pushes to main and on a dispatch, and refuses a dispatch on another ref", () => {
    expect(workflow).toMatch(
      /\non:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n\n/,
    );
    const [first] = steps("build");
    expect(first).toContain('if [ "$REF" != refs/heads/main ]; then');
    expect(first).toMatch(/\n {12}exit 1\n/);
  });

  it("lands its commits in order: one group, and a running run is never cancelled", () => {
    expect(workflow).toContain(
      "\nconcurrency:\n  group: build-branch\n  cancel-in-progress: false\n",
    );
    expect(workflow).toContain("\npermissions: {}\n");
  });

  it("builds with read access only, without credentials, at the pinned Node version", () => {
    expect(job("build")).toMatch(/\n {4}permissions:\n {6}contents: read\n/);
    expect(job("build")).toContain("persist-credentials: false");
    expect(job("build")).toContain("node scripts/build-package.ts");
    expect(job("build")).toContain('node scripts/build-consumer.ts --tree "$RUNNER_TEMP/tree"');
    expect(workflow).toContain('\n  NODE_VERSION: "24.22.2"\n');
    for (const name of ["build", "verify"])
      expect(job(name), name).toContain("node-version: ${{ env.NODE_VERSION }}");
  });

  it("publishes from the build-branch environment with no token permissions and no checkout", () => {
    const publish = job("publish");
    expect(publish).toMatch(/\n {4}needs: build\n/);
    expect(publish).toMatch(/\n {4}environment: build-branch\n/);
    expect(publish).toMatch(/\n {4}permissions: \{\}\n/);
    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toMatch(/\bnode\b|\bpnpm\b/);
  });

  it("holds the deploy key only in the publish job, in an agent, never in a file", () => {
    for (const [name, text] of jobs)
      if (name !== "publish") expect(text, name).not.toContain("BUILD_BRANCH_DEPLOY_KEY");
    const publish = job("publish");
    expect(publish).toContain("DEPLOY_KEY: ${{ secrets.BUILD_BRANCH_DEPLOY_KEY }}");
    expect(publish).toContain(`printf '%s\\n' "$DEPLOY_KEY" | ssh-add -`);
    expect(publish).not.toMatch(/"\$DEPLOY_KEY" *>/);
  });

  it("pins GitHub's SSH host keys, with the fingerprints that GitHub publishes", () => {
    const publish = job("publish");
    expect(publish).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toMatch(/StrictHostKeyChecking=(no|accept-new)/);
    const keys = [...publish.matchAll(/^ +github\.com (\S+) (\S+)$/gm)].map(
      (m) => [m[1]!, m[2]!] as const,
    );
    expect(keys.map(([type, key]) => [type, fingerprint(key)])).toEqual([
      ["ssh-ed25519", "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"],
      ["ecdsa-sha2-nistp256", "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM"],
      ["ssh-rsa", "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s"],
    ]);
  });

  it("appends one commit with the Source-Commit trailer, never with force, and never moves back", () => {
    const publish = job("publish");
    expect(publish).toContain(
      `printf 'build: %s\\n\\nSource-Commit: %s\\n' "$TITLE" "$GITHUB_SHA"`,
    );
    expect(publish).toContain('git commit-tree "$tree" "${parents[@]}"');
    expect(publish).toContain('parents=(-p "$head")');
    expect(publish).toContain('git push --quiet origin "$commit:refs/heads/build"');
    expect(publish).not.toMatch(/--force|push [^\n]* -f\b|\+refs\/heads\/build|\+\$commit/);
    expect(publish).toContain('git merge-base --is-ancestor "$previous" "$GITHUB_SHA"');
    expect(publish).toContain("ichnaea-build@users.noreply.github.com");
  });

  it("skips the commit when the tree equals the build branch's tree", () => {
    expect(job("publish")).toContain('if [ "$(git rev-parse "$head^{tree}")" = "$tree" ]; then');
  });

  it("verifies the build commit with read access only", () => {
    const verify = job("verify");
    expect(verify).toMatch(/\n {4}needs: publish\n/);
    expect(verify).toMatch(/\n {4}permissions:\n {6}contents: read\n/);
    expect(verify).toContain('node scripts/verify-build.ts "$COMMIT"');
  });

  it("is the only workflow that names the build-branch environment or its key", () => {
    const named = readdirSync(join(github, "workflows")).filter((file) =>
      /environment:\s*(?:\n\s*name:\s*)?["']?build-branch\b|BUILD_BRANCH_DEPLOY_KEY/.test(
        read("workflows", file),
      ),
    );
    expect(named).toEqual(["build-branch.yml"]);
  });
});

describe("the build rulesets", () => {
  it("let only deploy keys create, update or delete build", () => {
    expect(ruleset("build.json")).toEqual({
      name: "build: only the build workflow's deploy key writes it",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/heads/build"], exclude: [] } },
      rules: [
        { type: "creation" },
        { type: "update" },
        { type: "deletion" },
        { type: "non_fast_forward" },
      ],
      bypass_actors: [{ actor_id: null, actor_type: "DeployKey", bypass_mode: "always" }],
    });
  });

  it("block force pushes and the deletion of build for everyone, the deploy key too", () => {
    expect(ruleset("build-no-force-push.json")).toMatchObject({
      conditions: { ref_name: { include: ["refs/heads/build"], exclude: [] } },
      rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
      bypass_actors: [],
    });
  });

  it("require no signature on build, and one on every other branch", () => {
    for (const file of ["build.json", "build-no-force-push.json"])
      expect(JSON.stringify(ruleset(file)), file).not.toContain("required_signatures");
    expect(ruleset("signed-commits.json")).toEqual({
      name: "signed commits",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/build"] } },
      rules: [{ type: "required_signatures" }],
      bypass_actors: [],
    });
  });

  it("let nobody create a release tag while releases are paused", () => {
    expect(ruleset("release-tags-create.json")).toEqual({
      name: "release tags: nobody creates them while releases are paused",
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
      rules: [{ type: "creation" }],
      bypass_actors: [],
    });
  });
});

describe("the build verification", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("reads exactly one full Source-Commit trailer", () => {
    expect(sourceCommitOf(`build: a title\n\nSource-Commit: ${sha}\n`)).toBe(sha);
    expect(() => sourceCommitOf("build: a title\n")).toThrow("0 Source-Commit trailers");
    expect(() =>
      sourceCommitOf(`build: x\n\nSource-Commit: ${sha}\nSource-Commit: ${sha}\n`),
    ).toThrow("2 Source-Commit trailers");
    expect(() => sourceCommitOf("build: x\n\nSource-Commit: 0123abc\n")).toThrow(
      "is not a full commit SHA",
    );
  });

  it("refuses another Node or pnpm than the build used", () => {
    const info = { node: "v24.22.2", pnpm: "12.3.4", sourceCommit: sha, treeDigest: "" };
    expect(toolProblems(info, "v24.22.2", "12.3.4")).toEqual([]);
    expect(toolProblems(info, "v24.3.0", "12.3.4")).toEqual([
      "the build used Node v24.22.2; run the verification with it, not v24.3.0",
    ]);
    expect(toolProblems(info, "v24.22.2", "12.4.0")).toEqual([
      "the build used pnpm 12.3.4; run the verification with it, not 12.4.0",
    ]);
  });
});
