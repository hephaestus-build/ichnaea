// Writes the release SBOM (CycloneDX JSON) from what is shipped: it installs the tarballs into an
// empty project (tarball-project.ts) and lets pnpm list that project's production dependencies.
// pnpm gives each tarball's path on this machine as its distribution URL; the SBOM gives the
// tarball's download URL on the release instead.
// Usage: node scripts/release-sbom.ts <directory with .tgz files> <output file> [<tag>]
// Without a tag, as in CI, the URLs name the placeholder tag `untagged`, and no release has them.
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { installTarballs } from "./tarball-project.ts";
import { downloadUrl } from "./release-notes.ts";

/** The tag in the download URLs of an SBOM that is not for a release. It is not a release tag. */
export const UNTAGGED = "untagged";

/** The tag that a script's optional tag argument names: a release tag, or {@link UNTAGGED}. */
export function tagArgument(arg: string | undefined): string {
  if (arg === undefined) return UNTAGGED;
  if (!/^v0\.\d+\.\d+$/.test(arg)) throw new Error(`release tag ${arg} is not v0.x.y`);
  return arg;
}

interface Bom {
  readonly components?: ReadonlyArray<{
    readonly externalReferences?: Array<{ readonly type?: string; url?: string }>;
  }>;
}

/**
 * Changes each distribution URL that is a path to one of the tarballs into that tarball's download
 * URL for the tag. A path to any other file is an error: the SBOM would publish a path on this
 * machine.
 */
export function withDownloadUrls(bom: Bom, tag: string, tarballs: readonly string[]): Bom {
  for (const component of bom.components ?? [])
    for (const reference of component.externalReferences ?? []) {
      if (reference.type !== "distribution" || !reference.url?.startsWith("file:")) continue;
      const file = basename(reference.url);
      if (!tarballs.includes(file))
        throw new Error(`the SBOM has a path that is not a shipped tarball: ${reference.url}`);
      reference.url = downloadUrl(tag, file);
    }
  return bom;
}

if (import.meta.main) {
  const [dir, out, tagArg] = process.argv.slice(2);
  if (!dir || !out)
    throw new Error("usage: release-sbom.ts <tarball directory> <output file> [<tag>]");
  const tag = tagArgument(tagArg);
  const { project, tarballs } = installTarballs(dir);
  try {
    const sbom = execFileSync("pnpm", ["sbom", "--sbom-format", "cyclonedx", "--prod"], {
      cwd: project,
      encoding: "utf8",
    });
    const bom = withDownloadUrls(
      JSON.parse(sbom) as Bom,
      tag,
      tarballs.map((t) => basename(t.file)),
    );
    writeFileSync(out, `${JSON.stringify(bom, null, 2)}\n`);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
