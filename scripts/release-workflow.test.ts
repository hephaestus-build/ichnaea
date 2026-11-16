// The release workflow (decision 0021), read as text by its indentation: a job is a key at two spaces
// under `jobs:`, a step an item at six. No job has an environment or a deploy key. The build job
// checks and packs with read access only, the release job holds the write permissions and runs no
// repository code, and the verify job checks the published tarball by its attestation.
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
/** The workflow without its comments. */
const code = workflow
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");
const triggers = /\non:\n((?: {2}.*\n)+)/.exec(workflow)?.[1] ?? "";
const job = (name: string): string => jobs.get(name) ?? "";
const steps = (name: string): string[] =>
  job(name)
    .split(/\n {6}- /)
    .slice(1);
/** The step of a job that contains a text, and its index. */
const step = (name: string, text: string): [number, string] => {
  const i = steps(name).findIndex((s) => s.includes(text));
  return [i, steps(name)[i] ?? ""];
};
/** A job's permissions, as `scope: access` lines without their comments. */
const permissions = (name: string): string[] =>
  (/\n {4}permissions:\n((?: {6}.*\n)+)/.exec(job(name))?.[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l !== "");

describe("release workflow", () => {
  it("has the build, release and verify jobs, in that order of needs", () => {
    expect([...jobs.keys()]).toEqual(["build", "release", "verify"]);
    expect(job("release")).toMatch(/\n {4}needs: build\n/);
    expect(job("verify")).toMatch(/\n {4}needs: \[build, release\]\n/);
  });

  it("starts only by hand, with the tag, and is not paused", () => {
    expect(workflow).toMatch(/\non:\n {2}workflow_dispatch:\n {4}inputs:\n {6}tag:\n/);
    expect(triggers.match(/^ {2}\w+:/gm)).toEqual(["  workflow_dispatch:"]);
    expect(workflow).not.toMatch(/paused/i);
  });

  it("has no environment and no deploy key, and reads no secret", () => {
    expect(code).not.toMatch(/^\s*environment:/m);
    expect(code).not.toContain("ssh-key");
    expect(code).not.toMatch(/deploy.key|DEPLOY_KEY/i);
    expect(code).not.toContain("secrets.");
  });

  it("gives each job only the permissions that it needs", () => {
    expect(workflow).toMatch(/\npermissions: \{\}\n/);
    expect(permissions("build")).toEqual(["contents: read"]);
    expect(permissions("release")).toEqual([
      "contents: write",
      "id-token: write",
      "attestations: write",
    ]);
    expect(permissions("verify")).toEqual(["contents: read", "attestations: read"]);
  });

  it("checks main and the tag before it installs or builds anything", () => {
    const [onMain] = step("build", "node scripts/check-on-main.ts");
    const [tag, tagStep] = step("build", "node scripts/check-release-tag.ts");
    const [install] = step("build", "pnpm install --frozen-lockfile");
    expect(onMain).toBeGreaterThan(0);
    expect(tag).toBeGreaterThan(onMain);
    expect(install).toBeGreaterThan(tag);
    expect(tagStep).toContain('echo "version=${TAG#v}" >> "$GITHUB_OUTPUT"');
    // The tag check reads the tags with git, so the checkout has all of them.
    expect(steps("build")[0]).toContain("fetch-depth: 0");
  });

  it("stamps the tag's version into the tree that it checks, tests and packs", () => {
    const [assemble, text] = step("build", "node scripts/build-package.ts");
    expect(text).toContain('--source-commit "$GITHUB_SHA" --version "$VERSION"');
    expect(text).toContain("VERSION: ${{ steps.tag.outputs.version }}");
    const [packageCheck] = step("build", 'node scripts/check-package.ts "$RUNNER_TEMP/tree"');
    const [consumer] = step("build", 'node scripts/build-consumer.ts --tree "$RUNNER_TEMP/tree"');
    const [pack, packStep] = step("build", "pnpm pack --pack-destination");
    expect([assemble, packageCheck, consumer, pack]).toEqual(
      [assemble, packageCheck, consumer, pack].toSorted((a, b) => a - b),
    );
    expect(assemble).toBeGreaterThan(step("build", "run: pnpm run check")[0]);
    expect(packStep).toContain("working-directory: ${{ runner.temp }}/tree");
    expect(packStep).toContain(
      'test -f "$GITHUB_WORKSPACE/release/hephaestus-build-ichnaea-$VERSION.tgz"',
    );
  });

  it("runs the checks, the SBOM check, the checksums and the notes in the build job", () => {
    expect(job("build")).toContain("- run: pnpm run check\n");
    expect(job("build")).toContain(
      'node scripts/check-sbom.ts release/sbom.cdx.json release "$TAG"',
    );
    expect(job("build")).toContain("sha256sum -- *.tgz sbom.cdx.json > SHA256SUMS");
    expect(job("build")).toContain(
      'node scripts/release-notes.ts "$TAG" "$GITHUB_SHA" > release-notes.md',
    );
  });

  it("runs no repository code in the release job, and attests before it publishes", () => {
    expect(job("release")).not.toContain("actions/checkout@");
    expect(job("release")).not.toMatch(/\bnode |pnpm /);
    const [check] = step("release", "sha256sum --check --strict SHA256SUMS");
    const [provenance] = step("release", "name: Attest build provenance");
    const [sbom, sbomStep] = step("release", "name: Attest the SBOM");
    const [publish] = step("release", "gh release create");
    expect(check).toBeGreaterThan(0);
    expect(provenance).toBeGreaterThan(check);
    expect(sbom).toBeGreaterThan(provenance);
    expect(publish).toBeGreaterThan(sbom);
    expect(sbomStep).toContain("sbom-path: release/sbom.cdx.json");
    for (const text of [job("build"), job("verify")])
      expect(text).not.toMatch(/actions\/attest@|gh release create/);
  });

  it("publishes a regular release whose tag it creates on the released commit", () => {
    const [, publish] = step("release", "gh release create");
    expect(publish).toContain(
      'gh release create "$TAG" "release/hephaestus-build-ichnaea-$VERSION.tgz" \\\n' +
        "            release/sbom.cdx.json release/SHA256SUMS \\\n" +
        '            --target "$GITHUB_SHA" --title "$TAG" --notes-file release-notes.md',
    );
    expect(workflow).not.toContain("--prerelease");
    expect(workflow).not.toContain("--verify-tag");
    expect(workflow).not.toContain("--draft");
    // An existing tag would be released wherever it points: the job refuses it, then checks the tag.
    expect(publish.indexOf("exists already")).toBeLessThan(publish.indexOf("gh release create"));
    expect(publish).toContain('if [ "$tagged" != "$GITHUB_SHA" ]; then');
  });

  it("verifies the published tarball by its URL, its signer workflow on main, and its bin", () => {
    const verify = job("verify");
    expect(verify).toContain(
      '"https://github.com/$GITHUB_REPOSITORY/releases/download/$TAG/hephaestus-build-ichnaea-$VERSION.tgz"',
    );
    expect(verify).toContain(
      '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release.yml"',
    );
    expect(verify).toContain("--source-ref refs/heads/main --deny-self-hosted-runners");
    expect(verify).toContain('node scripts/tarball-project.ts "$RUNNER_TEMP/download" "$TAG"');
    expect(verify).not.toContain("download-artifact");
  });

  it("never persists the checkout's credentials", () => {
    const checkouts = workflow.split("actions/checkout@").slice(1);
    expect(checkouts).toHaveLength(2);
    for (const c of checkouts)
      expect(c.split("\n      - ")[0]).toContain("persist-credentials: false");
  });
});

const ruleset = (file: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", ".github", "rulesets", file), "utf8"),
  ) as unknown;
const tags = { ref_name: { include: ["refs/tags/v*"], exclude: [] } };

describe("the release tag rulesets", () => {
  it("let nobody move or delete a release tag", () => {
    expect(ruleset("release-tags-fixed.json")).toEqual({
      name: "release tags: nobody moves or deletes them",
      target: "tag",
      enforcement: "active",
      conditions: tags,
      rules: [{ type: "update" }, { type: "deletion" }],
      bypass_actors: [],
    });
  });

  it("let only the Maintain and Admin roles and the workflow token create one", () => {
    expect(ruleset("release-tags-create.json")).toEqual({
      name: "release tags: only maintainers and workflows create them",
      target: "tag",
      enforcement: "active",
      conditions: tags,
      rules: [{ type: "creation" }],
      bypass_actors: [
        // The repository roles Maintain and Admin, and the GitHub Actions app.
        { actor_id: 2, actor_type: "RepositoryRole", bypass_mode: "always" },
        { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        { actor_id: 15368, actor_type: "Integration", bypass_mode: "always" },
      ],
    });
  });
});
