// Writes an SBOM (CycloneDX JSON) from what is shipped: it installs the packed package into an
// empty project (tarball-project.ts) and lets pnpm list that project's production dependencies.
//
// The build SBOM (`buildSbom`) describes one build tree of the `build` branch, and
// scripts/build-package.ts writes it into the tree as sbom.cdx.json. It is deterministic: its
// timestamp is the source commit's committer date and its serial number derives from the source
// commit, so two builds of one commit give the same bytes.
//
// The release SBOM describes the tarball of a release (decision 0021). pnpm gives the tarball's path
// on this machine as its distribution URL; the release SBOM gives its download URL on the release
// instead.
// Usage: node scripts/release-sbom.ts <directory with .tgz files> <output file> [<tag>]
// Without a tag, the URLs name the placeholder tag `untagged`, and no release has them.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { installTarballs } from "./tarball-project.ts";
import { downloadUrl } from "./release-notes.ts";

/**
 * The namespace of the build SBOMs' serial numbers: each serial number is the UUID version 5 of a
 * source commit's SHA in this namespace. It was drawn at random once. Never change it: the serial
 * numbers of every published build commit derive from it.
 */
export const SERIAL_NAMESPACE = "349797ff-cf93-4b84-ac87-5a356cce1d31";

/** The UUID version 5 (RFC 9562) of a name in a namespace. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replaceAll("-", ""), "hex");
  if (ns.length !== 16) throw new Error(`${namespace} is not a UUID`);
  const bytes = createHash("sha1").update(ns).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The serial number of the build SBOM of a source commit. */
export const buildSerialNumber = (sourceCommit: string): string =>
  `urn:uuid:${uuidV5(sourceCommit, SERIAL_NAMESPACE)}`;

interface BuildBomComponent {
  readonly name: string;
  readonly group?: string;
  readonly version?: string;
  readonly "bom-ref"?: string;
  readonly externalReferences?: ReadonlyArray<{ readonly type?: string; readonly url?: string }>;
  readonly [key: string]: unknown;
}

interface PnpmBom {
  readonly metadata?: { readonly [key: string]: unknown };
  readonly components?: readonly BuildBomComponent[];
  readonly dependencies?: ReadonlyArray<{ readonly ref: string; readonly dependsOn?: string[] }>;
  readonly [key: string]: unknown;
}

const byRef = (a: { "bom-ref"?: string; ref?: string }, b: typeof a): number => {
  const x = a["bom-ref"] ?? a.ref ?? "";
  const y = b["bom-ref"] ?? b.ref ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Turns the SBOM that pnpm writes for the scratch project into the SBOM of the build: the package
 * becomes the top-level component, the scratch project leaves, the source commit is named, and
 * nothing depends on the time or the machine. The packed tarball's path and digest leave too: a
 * consumer never installs that tarball, it installs the build commit.
 */
export function buildBom(
  bom: PnpmBom,
  pkg: { name: string; version: string },
  sourceCommit: string,
  date: string,
): Record<string, unknown> {
  const fullName = (c: BuildBomComponent): string => (c.group ? `${c.group}/${c.name}` : c.name);
  const components = bom.components ?? [];
  const own = components.find((c) => fullName(c) === pkg.name && c.version === pkg.version);
  if (!own) throw new Error(`the SBOM does not list ${pkg.name}@${pkg.version}`);
  const scratch = bom.metadata?.["component"] as BuildBomComponent | undefined;
  const component = {
    ...own,
    externalReferences: [
      ...(own.externalReferences ?? []).filter((r) => r.type !== "distribution"),
      { type: "vcs", url: `git+https://github.com/hephaestus-build/ichnaea.git#${sourceCommit}` },
    ],
  };
  for (const c of components)
    for (const r of c.externalReferences ?? [])
      if (c !== own && r.url?.startsWith("file:"))
        throw new Error(`the SBOM has a path on this machine: ${r.url}`);
  return {
    ...bom,
    serialNumber: buildSerialNumber(sourceCommit),
    metadata: { ...bom.metadata, timestamp: date, component },
    components: components.filter((c) => c !== own).toSorted(byRef),
    dependencies: (bom.dependencies ?? [])
      .filter((d) => d.ref !== scratch?.["bom-ref"])
      .map((d) => ({ ...d, dependsOn: (d.dependsOn ?? []).toSorted() }))
      .toSorted(byRef),
  };
}

/** Packs a build tree, installs it into a scratch project with zod, and returns its build SBOM. */
export function buildSbom(
  tree: string,
  sourceCommit: string,
  date: string,
): Record<string, unknown> {
  const pkg = JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const packed = mkdtempSync(join(tmpdir(), "ichnaea-build-sbom-"));
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", packed], { cwd: tree, stdio: "ignore" });
    const { project } = installTarballs(packed);
    try {
      const sbom = execFileSync("pnpm", ["sbom", "--sbom-format", "cyclonedx", "--prod"], {
        cwd: project,
        encoding: "utf8",
      });
      return buildBom(JSON.parse(sbom) as PnpmBom, pkg, sourceCommit, date);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  } finally {
    rmSync(packed, { recursive: true, force: true });
  }
}

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
