// Writes the release notes: the install snippet with every tarball URL, and how to verify it.
// Usage: node scripts/release-notes.ts <tag> > notes.md
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * How a consumer verifies a downloaded tarball. The README shows the same commands, and a test
 * keeps the two equal. Only the release workflow on main can sign an attestation that passes.
 */
export const VERIFY = `\`\`\`sh
# Build provenance: built by the release workflow from a commit on main, on a GitHub-hosted runner
gh attestation verify <tarball> --repo hephaestus-build/ichnaea \\
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \\
  --source-ref refs/heads/main --deny-self-hosted-runners
# The SBOM (CycloneDX) attested for the same tarball
gh attestation verify <tarball> --repo hephaestus-build/ichnaea \\
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \\
  --source-ref refs/heads/main --deny-self-hosted-runners \\
  --predicate-type https://cyclonedx.org/bom
# Checksums of the tarballs you downloaded
sha256sum --check --ignore-missing SHA256SUMS
\`\`\``;

/** The pnpm overrides that map each package to its tarball on the release. The README has v0.1.0's. */
export function overrides(tag: string, names: readonly string[]): string {
  const version = tag.replace(/^v/, "");
  const url = (name: string): string =>
    `https://github.com/hephaestus-build/ichnaea/releases/download/${tag}/${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
  return `\`\`\`yaml
overrides:
${names.map((n) => `  "${n}": "${url(n)}"`).join("\n")}
\`\`\``;
}

/** The names of the packages that a release ships, in the order of their directories. */
export function releasedPackages(): string[] {
  const root = join(import.meta.dirname, "..", "packages");
  return readdirSync(root)
    .map(
      (dir) =>
        JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as {
          name: string;
          private?: boolean;
        },
    )
    .filter((p) => !p.private)
    .map((p) => p.name);
}

export function releaseNotes(tag: string, names: readonly string[]): string {
  return `Pre-release ${tag}. Not published to npm.

## Install

Map every Ichnaea package to its tarball, so that the dependencies between them resolve without a
registry. With pnpm, in \`pnpm-workspace.yaml\`:

${overrides(tag, names)}

Then add the packages you import by the same URLs, and zod. The lockfile then pins each tarball's
integrity hash.

## Verify

${VERIFY}

Each tarball has a build provenance attestation and an SBOM attestation. The SBOM,
\`sbom.cdx.json\`, lists the packages of this release, their dependencies, and zod, their peer
dependency, at the version the release was tested with.
`;
}

if (import.meta.main) {
  const tag = process.argv[2] ?? "";
  if (!/^v0\.\d+\.\d+$/.test(tag)) throw new Error(`release tag ${tag} is not v0.x.y`);
  process.stdout.write(releaseNotes(tag, releasedPackages()));
}
