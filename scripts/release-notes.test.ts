import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { overrides, releasedPackages, releaseNotes, VERIFY } from "./release-notes.ts";

describe("release notes", () => {
  const notes = releaseNotes("v0.1.0", ["@hephaestus-build/ichnaea-core"]);

  it("map each package to its tarball on the release", () => {
    expect(notes).toContain(
      '"@hephaestus-build/ichnaea-core": "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-core-0.1.0.tgz"',
    );
  });

  it("verify the signer workflow and main, not only the repository", () => {
    expect(notes).toContain(VERIFY);
    expect(VERIFY).toContain(
      "--signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml",
    );
    expect(VERIFY).toContain("--source-ref refs/heads/main");
    expect(VERIFY).toContain("sha256sum --check --ignore-missing SHA256SUMS");
  });

  it("give the same verify commands and overrides as the README", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
    expect(readme).toContain(VERIFY);
    expect(readme).toContain(overrides("v0.1.0", releasedPackages()));
  });
});
