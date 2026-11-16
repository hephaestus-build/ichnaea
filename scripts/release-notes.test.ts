import { describe, expect, it } from "vitest";

import { releaseNotes, VERIFY } from "./release-notes.ts";

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
});
