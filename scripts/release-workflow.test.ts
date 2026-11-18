// The release workflows (decision 0021), read as text by their indentation: a job is a key at two
// spaces under `jobs:`, a step an item at six. `release.yml` starts on a pushed v* tag, checks and
// packs with read access only, and stages the tarball on npm through a stage-only trusted
// publisher. `release-finish.yml` runs after a package owner approved the staged version on npm: it
// verifies the published version and creates the GitHub release. Neither holds a long-lived token.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const github = join(import.meta.dirname, "..", ".github");

interface Workflow {
  readonly text: string;
  /** The workflow without its comment lines. */
  readonly code: string;
  readonly triggers: string;
  readonly job: (name: string) => string;
  readonly jobNames: readonly string[];
  readonly steps: (name: string) => string[];
  /** The step of a job that contains a text, and its index. */
  readonly step: (name: string, text: string) => [number, string];
  /** A job's permissions, as `scope: access` lines without their comments. */
  readonly permissions: (name: string) => string[];
}

function read(file: string): Workflow {
  const text = readFileSync(join(github, "workflows", file), "utf8");
  const jobs = new Map(
    (text.split("\njobs:\n")[1] ?? "")
      .split(/\n(?= {2}[\w-]+:\n)/)
      .map((job) => [job.trim().split(":")[0] ?? "", job]),
  );
  const job = (name: string): string => jobs.get(name) ?? "";
  const steps = (name: string): string[] =>
    job(name)
      .split(/\n {6}- /)
      .slice(1);
  return {
    text,
    code: text
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n"),
    triggers: /\non:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? "",
    job,
    jobNames: [...jobs.keys()],
    steps,
    step: (name, needle) => {
      const i = steps(name).findIndex((s) => s.includes(needle));
      return [i, steps(name)[i] ?? ""];
    },
    permissions: (name) =>
      (/\n {4}permissions:\n((?: {6}.*\n)+)/.exec(job(name))?.[1] ?? "")
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter((l) => l !== ""),
  };
}

const release = read("release.yml");
const finish = read("release-finish.yml");

describe("both release workflows", () => {
  it.each([
    ["release.yml", release],
    ["release-finish.yml", finish],
  ])("%s holds no long-lived token and reads no secret", (_, w) => {
    expect(w.code).not.toMatch(/secrets\./);
    expect(w.code).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
    // setup-node with a registry URL writes an .npmrc that expects a token.
    expect(w.code).not.toContain("registry-url");
    expect(w.code).not.toMatch(/ssh-key|deploy.key/i);
    expect(w.text).toMatch(/\npermissions: \{\}\n/);
  });

  it.each([
    ["release.yml", release],
    ["release-finish.yml", finish],
  ])("%s never publishes to npm directly", (_, w) => {
    expect(w.code).not.toMatch(/npm publish|pnpm publish|--allow-publish/);
  });

  it.each([
    ["release.yml", release],
    ["release-finish.yml", finish],
  ])("%s never persists the checkout's credentials", (_, w) => {
    const checkouts = w.text.split("actions/checkout@").slice(1);
    expect(checkouts.length).toBeGreaterThan(0);
    for (const c of checkouts)
      expect(c.split("\n      - ")[0]).toContain("persist-credentials: false");
  });

  it("are the only workflows that name the npm environment or stage a version", () => {
    for (const file of readdirSync(join(github, "workflows"))) {
      const { code } = read(file);
      const names = /\n {4}environment: npm\n|npm stage/.test(code);
      expect(names, file).toBe(file === "release.yml");
    }
  });
});

describe("release.yml", () => {
  it("starts only on a pushed v* tag", () => {
    expect(release.triggers).toBe('  push:\n    tags: ["v*"]\n');
  });

  it("checks, packs, runs the consumer test and then stages, in that order of needs", () => {
    expect(release.jobNames).toEqual(["check", "pack", "consumer", "stage"]);
    expect(release.job("pack")).toMatch(/\n {4}needs: check\n/);
    expect(release.job("consumer")).toMatch(/\n {4}needs: pack\n/);
    expect(release.job("stage")).toMatch(/\n {4}needs: \[check, pack, consumer\]\n/);
  });

  it("gives each job only the permissions that it needs", () => {
    for (const job of ["check", "pack", "consumer"])
      expect(release.permissions(job), job).toEqual(["contents: read"]);
    expect(release.permissions("stage")).toEqual(["id-token: write"]);
  });

  it("checks the tagged commit and the tag before it installs anything", () => {
    const [onMain, onMainStep] = release.step("check", "node scripts/check-on-main.ts");
    const [tag, tagStep] = release.step("check", "node scripts/check-release-tag.ts");
    const [install] = release.step("check", "pnpm install --frozen-lockfile");
    const [check] = release.step("check", "run: pnpm run check");
    expect(onMainStep).toContain('"$GITHUB_REF" "$GITHUB_SHA"');
    expect(tagStep).toContain('"$TAG" "$GITHUB_SHA" >> "$GITHUB_OUTPUT"');
    expect(tagStep).toContain("TAG: ${{ github.ref_name }}");
    expect([onMain, tag, install, check]).toEqual([0, 1, 2, 3].map((i) => i + onMain));
    expect(release.job("check")).toMatch(/fetch-depth: 0\n/);
  });

  it("stamps the tag's version, checks the tree, and packs it once", () => {
    const [assemble, assembleStep] = release.step("pack", "node scripts/build-package.ts");
    const [packageCheck] = release.step("pack", "node scripts/check-package.ts");
    const [pack, packStep] = release.step("pack", "pnpm pack --pack-destination");
    expect(assembleStep).toContain('--source-commit "$GITHUB_SHA" --version "$VERSION"');
    expect(assembleStep).toContain("VERSION: ${{ needs.check.outputs.version }}");
    expect(assemble).toBeLessThan(packageCheck);
    expect(packageCheck).toBeLessThan(pack);
    expect(packStep).toContain("working-directory: ${{ runner.temp }}/tree");
    expect(release.code.match(/pnpm pack\b/g)).toHaveLength(1);
  });

  it("records the tarball's SHA-512 as npm writes it, and writes the SBOM, checksums and notes", () => {
    const [, integrity] = release.step("pack", "openssl dgst -sha512 -binary");
    expect(integrity).toContain("base64 -w0");
    expect(integrity).toContain('echo "integrity=$integrity" >> "$GITHUB_OUTPUT"');
    expect(release.job("pack")).toContain("integrity: ${{ steps.integrity.outputs.integrity }}");
    expect(release.job("pack")).toContain(
      "node scripts/release-sbom.ts release/assets release/assets/sbom.cdx.json",
    );
    expect(release.job("pack")).toContain(
      "node scripts/check-sbom.ts release/assets/sbom.cdx.json release/assets",
    );
    expect(release.job("pack")).toContain("sha256sum -- *.tgz sbom.cdx.json > SHA256SUMS");
    expect(release.job("pack")).toContain(
      'node scripts/release-notes.ts "$TAG" "$GITHUB_SHA" > release/release-notes.md',
    );
    expect(release.job("pack")).toContain("retention-days: 90");
  });

  it("runs the consumer test on the packed tarball on Node 24.3 and 26", () => {
    expect(release.job("consumer")).toContain('node: ["24.3.0", "26"]');
    expect(release.job("consumer")).toContain("node-version: ${{ matrix.node }}");
    expect(release.job("consumer")).toContain(
      'node scripts/build-consumer.ts --tarball "release/assets/$TARBALL"',
    );
  });

  it("stages in the npm environment, with no checkout, after checking the SHA-512 and npm", () => {
    const stage = release.job("stage");
    expect(stage).toMatch(/\n {4}environment: npm\n/);
    for (const job of ["check", "pack", "consumer"])
      expect(release.job(job), job).not.toMatch(/environment:|npm stage|id-token/);
    expect(stage).not.toContain("actions/checkout@");
    expect(stage).not.toMatch(/\bnode scripts|pnpm /);
    const [digest, digestStep] = release.step("stage", "openssl dgst -sha512 -binary");
    const [npm, npmStep] = release.step("stage", "NPM_INTEGRITY:");
    const [pinnedCheck, pinnedStep] = release.step(
      "stage",
      'if [ "$(npm --version)" != "$NPM_VERSION" ]; then',
    );
    const [publish, publishStep] = release.step("stage", "npm stage publish");
    expect(digestStep).toContain("INTEGRITY: ${{ needs.pack.outputs.integrity }}");
    // An exact npm, 11.15.0 or later, and never the npm that Node bundles.
    const pinned = /NPM_VERSION: "(\d+)\.(\d+)\.(\d+)"/.exec(npmStep);
    expect(pinned).not.toBeNull();
    const [major, minor] = [Number(pinned?.[1]), Number(pinned?.[2])];
    expect(major > 11 || (major === 11 && minor >= 15), pinned?.[0]).toBe(true);
    expect(npmStep).toMatch(/NPM_INTEGRITY: sha512-[A-Za-z0-9+/]+={0,2}\n/);
    expect(npmStep).toContain('if [ "$actual" != "$NPM_INTEGRITY" ]; then');
    expect(npmStep).toContain('"$RUNNER_TEMP/npm/package/bin/npm-cli.js"');
    expect(npmStep).toContain('echo "$RUNNER_TEMP/npm-bin" >> "$GITHUB_PATH"');
    expect(npmStep.indexOf('$NPM_INTEGRITY" ]')).toBeLessThan(npmStep.indexOf("tar -xzf"));
    expect(pinnedStep).toContain(`NPM_VERSION: "${pinned?.[1]}.${pinned?.[2]}.${pinned?.[3]}"`);
    expect(npm).toBeLessThan(pinnedCheck);
    expect(pinnedCheck).toBeLessThan(publish);
    expect(digest).toBeLessThan(publish);
    expect(npm).toBeLessThan(publish);
    expect(publishStep).toContain(
      'npm stage publish "./release/assets/$TARBALL" --provenance --access public \\\n' +
        '            --tag "$DIST_TAG" --ignore-scripts',
    );
    expect(publishStep).toContain("DIST_TAG: ${{ needs.check.outputs.dist-tag }}");
    expect(release.steps("stage").at(-1)).toBe(publishStep);
  });
});

describe("release-finish.yml", () => {
  it("starts by hand with a tag, or once a day", () => {
    expect(finish.triggers).toMatch(
      /^ {2}workflow_dispatch:\n {4}inputs:\n {6}tag:\n[\s\S]* {2}schedule:\n {4}- cron: "[\d *]+"\n$/,
    );
    expect(finish.triggers.match(/^ {2}\w+:/gm)).toEqual(["  workflow_dispatch:", "  schedule:"]);
  });

  it("finds the pending tags, then verifies and releases each tag on its own", () => {
    expect(finish.jobNames).toEqual(["pending", "verify", "release"]);
    expect(finish.job("verify")).toMatch(/\n {4}needs: pending\n/);
    expect(finish.job("verify")).toContain("if: needs.pending.outputs.tags != '[]'");
    expect(finish.job("release")).toMatch(/\n {4}needs: \[pending, verify\]\n/);
    // A failed verify of one tag skips the release of that tag alone.
    expect(finish.job("release")).toContain(
      "if: ${{ !cancelled() && needs.pending.result == 'success' && needs.pending.outputs.tags != '[]' }}",
    );
    for (const job of ["verify", "release"]) {
      expect(finish.job(job), job).toContain("tag: ${{ fromJSON(needs.pending.outputs.tags) }}");
      expect(finish.job(job), job).toContain("fail-fast: false");
    }
    expect(finish.job("pending")).toContain(
      'node scripts/release-pending.ts "$TAG" >> "$GITHUB_OUTPUT"',
    );
  });

  it("gives each job only the permissions that it needs", () => {
    expect(finish.permissions("pending")).toEqual(["contents: read"]);
    expect(finish.permissions("verify")).toEqual(["contents: read", "actions: read"]);
    expect(finish.permissions("release")).toEqual(["contents: write", "actions: read"]);
  });

  it("runs only main's code, never the tag's", () => {
    const checkouts = finish.text.split("actions/checkout@").slice(1);
    expect(checkouts).toHaveLength(2);
    for (const c of checkouts) {
      const step = c.split("\n      - ")[0] ?? "";
      expect(step).toContain("ref: ${{ github.event.repository.default_branch }}");
      expect(step).toContain("fetch-depth: 0");
    }
    expect(finish.code).not.toMatch(/ref: refs\/tags|matrix\.tag \}\}\n {10}persist/);
  });

  it("finds the release run by the tag's commit, never by a branch name", () => {
    expect(finish.code).not.toMatch(/--branch|gh run list/);
    const [find, findStep] = finish.step("verify", "node scripts/release-run.ts");
    const [download, downloadStep] = finish.step("verify", "gh run download");
    expect(findStep).toContain('node scripts/release-run.ts "$TAG" >> "$GITHUB_OUTPUT"');
    expect(downloadStep).toContain('gh run download "$RUN"');
    expect(downloadStep).toContain("RUN: ${{ steps.run.outputs.run }}");
    expect(find).toBeLessThan(download);
  });

  it("verifies the registry's integrity, the provenance, the install and the example", () => {
    const verify = finish.job("verify");
    expect(verify).toContain('node scripts/verify-published.ts "$TAG" "$INTEGRITY"');
    expect(verify).toContain('node scripts/build-consumer.ts --spec "@tumaet/ichnaea@$VERSION"');
    const [check] = finish.step("verify", "node scripts/verify-published.ts");
    const [consumer] = finish.step("verify", "node scripts/build-consumer.ts");
    const [record, recordStep] = finish.step("verify", "actions/upload-artifact@");
    expect(check).toBeLessThan(record);
    expect(consumer).toBeLessThan(record);
    expect(recordStep).toContain("name: verified-${{ matrix.tag }}");
  });

  it("creates the GitHub release with no repository code, from the files that it checks", () => {
    const job = finish.job("release");
    expect(job).not.toContain("actions/checkout@");
    expect(job).not.toMatch(/\bnode |pnpm /);
    const [verified, verifiedStep] = finish.step("release", "actions/download-artifact@");
    const [check] = finish.step("release", "sha256sum --check --strict SHA256SUMS");
    const [hash, hashStep] = finish.step("release", "npm view");
    const [create, createStep] = finish.step("release", "gh release create");
    expect(verifiedStep).toContain("name: verified-${{ matrix.tag }}");
    expect([verified, check, hash, create]).toEqual(
      [verified, check, hash, create].toSorted((a, b) => a - b),
    );
    // Every tarball is hashed here and compared with npm, not only with the run's own files.
    expect(hashStep).toContain('npm view "@tumaet/ichnaea@$VERSION" dist.integrity');
    expect(hashStep).toContain("for tgz in release/assets/*.tgz; do");
    expect(hashStep).toContain('openssl dgst -sha512 -binary "$tgz" | base64 -w0');
    expect(createStep).toContain(
      'gh release create "$TAG" release/assets/*.tgz release/assets/sbom.cdx.json \\\n' +
        "            release/assets/SHA256SUMS --verify-tag",
    );
    expect(createStep).toContain('--notes-file release/release-notes.md "${prerelease[@]}"');
    for (const name of ["pending", "verify"])
      expect(finish.job(name), name).not.toContain("gh release create");
  });
});

describe("ci.yml, on every main commit (REQ-110)", () => {
  const ci = read("ci.yml");

  it("runs on every push to main and every pull request", () => {
    expect(ci.triggers).toContain("  push:\n    branches: [main]\n");
    expect(ci.triggers).toContain("  pull_request:\n");
  });

  it("packs the build tree and runs publint --strict and attw on it", () => {
    expect(ci.job("check")).toContain('node scripts/build-package.ts "$RUNNER_TEMP/tree"');
    expect(ci.job("check")).toContain('node scripts/check-package.ts "$RUNNER_TEMP/tree"');
  });

  it("installs the packed tarball and runs the consumer test on Node 24.3 and 26", () => {
    const matrix = /\n {8}node: (\[.*\])\n/.exec(ci.job("test"))?.[1] ?? "[]";
    expect(JSON.parse(matrix)).toEqual(expect.arrayContaining(["24.3.0", "26"]));
    expect(ci.job("test")).toContain("node-version: ${{ matrix.node }}");
    expect(ci.job("test")).toContain("run: node scripts/build-consumer.ts\n");
  });
});

const json = (...path: string[]): unknown =>
  JSON.parse(readFileSync(join(github, ...path), "utf8")) as unknown;
const tags = { ref_name: { include: ["refs/tags/v*"], exclude: [] } };

describe("the release settings", () => {
  it("let nobody move or delete a release tag", () => {
    expect(json("rulesets", "release-tags-fixed.json")).toEqual({
      name: "release tags: nobody moves or deletes them",
      target: "tag",
      enforcement: "active",
      conditions: tags,
      rules: [{ type: "update" }, { type: "deletion" }],
      bypass_actors: [],
    });
  });

  it("let only the release team, the maintainer team, create one", () => {
    expect(json("rulesets", "release-tags-create.json")).toEqual({
      name: "release tags: only the release team creates them",
      target: "tag",
      enforcement: "active",
      conditions: tags,
      rules: [{ type: "creation" }],
      bypass_actors: [{ actor_id: 19248737, actor_type: "Team", bypass_mode: "always" }],
    });
  });

  it("have an npm environment with no reviewer and no secret, and no release environment", () => {
    expect(json("environments", "npm.json")).toEqual({
      wait_timer: 0,
      prevent_self_review: false,
      can_admins_bypass: false,
      reviewers: [],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
    expect(readdirSync(join(github, "environments")).toSorted()).toEqual([
      "build-branch.json",
      "github-pages.json",
      "npm.json",
    ]);
  });
});
