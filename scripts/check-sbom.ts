// Fails unless the release SBOM describes what is shipped: its top-level component is the release
// project in the release's npm scope, every tarball is a component at its version with its
// SHA-512 and its download URL for the tag, and every runtime and peer dependency of every tarball
// is listed.
// Usage: node scripts/check-sbom.ts <sbom.cdx.json> <directory with .tgz files> [<tag>]
// Without a tag, the download URLs must name the placeholder tag of release-sbom.ts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { PROJECT, tarballsIn } from "./tarball-project.ts";
import { downloadUrl } from "./release-notes.ts";
import { tagArgument, UNTAGGED } from "./release-sbom.ts";

export interface Shipped {
  /** The tarball's file name, as on the release. */
  readonly file: string;
  readonly name: string;
  readonly version: string;
  readonly sha512: string;
  readonly dependencies: readonly string[];
}

interface Component {
  readonly name: string;
  readonly group?: string;
  readonly version?: string;
  readonly purl?: string;
  readonly externalReferences?: ReadonlyArray<{
    readonly type?: string;
    readonly url?: string;
    readonly hashes?: ReadonlyArray<{ readonly alg?: string; readonly content?: string }>;
  }>;
}

const isComponent = (c: unknown): c is Component =>
  typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string";

const fullName = (c: Component): string => (c.group ? `${c.group}/${c.name}` : c.name);

/** The package URL of an npm package: the `@` of a scope is percent-encoded. */
const npmPurl = (name: string, version: string): string =>
  `pkg:npm/${name.replace(/^@/, "%40")}@${version}`;

/**
 * Returns one finding per way in which the SBOM does not describe the shipped tarballs of the
 * release `tag`. `project` is the name of the top-level component, which has the version of the
 * tarballs.
 */
export function checkSbom(
  bom: unknown,
  shipped: readonly Shipped[],
  tag: string,
  project = PROJECT,
): string[] {
  const { bomFormat, components, metadata } = (bom ?? {}) as {
    bomFormat?: unknown;
    components?: unknown;
    metadata?: { component?: unknown };
  };
  if (bomFormat !== "CycloneDX") return ["the SBOM is not CycloneDX"];
  // Every shipped package has the same version, and so has the release.
  const version = shipped[0]?.version ?? "";
  const root = metadata?.component;
  const purl = npmPurl(project, version);
  // A tool that reads the top-level component as a package looks its purl up in an advisory
  // database, so it must name the release, not a package of another author.
  const rootFindings =
    isComponent(root) &&
    fullName(root) === project &&
    root.version === version &&
    root.purl === purl
      ? []
      : [`the SBOM's top-level component is not ${purl}`];
  // CycloneDX may leave out an empty component list.
  if (components === undefined || (Array.isArray(components) && components.length === 0))
    return [...rootFindings, "the SBOM lists no components"];
  if (!Array.isArray(components) || !components.every(isComponent))
    return [...rootFindings, "the SBOM has no valid component list"];
  const findings = [...rootFindings];
  const names = new Set(components.map(fullName));
  for (const p of shipped) {
    const own = components.find((c) => fullName(c) === p.name && c.version === p.version);
    if (!own) findings.push(`the SBOM misses the shipped package ${p.name}@${p.version}`);
    else {
      const distributions = (own.externalReferences ?? []).filter((r) => r.type === "distribution");
      if (
        !distributions.some((r) =>
          r.hashes?.some((h) => h.alg === "SHA-512" && h.content === p.sha512),
        )
      )
        findings.push(`${p.name}@${p.version} in the SBOM does not have the tarball's SHA-512`);
      // A consumer downloads the tarball from the release, not from a path on the build machine.
      const url = downloadUrl(tag, p.file);
      const urls = distributions.map((r) => r.url ?? "no URL");
      if (urls.length === 0 || urls.some((u) => u !== url))
        findings.push(
          `${p.name}@${p.version} in the SBOM is distributed at ${urls.join(", ") || "no URL"}, not ${url}`,
        );
    }
    for (const d of p.dependencies)
      if (!names.has(d)) findings.push(`the SBOM misses ${d}, a dependency of ${p.name}`);
  }
  return findings;
}

/** Reads each tarball's manifest and digest. */
export function shippedIn(dir: string): Shipped[] {
  return tarballsIn(dir).map((t) => {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", t.file, "package/package.json"], { encoding: "utf8" }),
    ) as { dependencies?: object; peerDependencies?: object };
    return {
      file: basename(t.file),
      name: t.name,
      version: t.version,
      sha512: createHash("sha512").update(readFileSync(t.file)).digest("hex"),
      dependencies: [
        ...new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
        ]),
      ],
    };
  });
}

if (import.meta.main) {
  const [sbom, dir, tagArg] = process.argv.slice(2);
  if (!sbom || !dir)
    throw new Error("usage: check-sbom.ts <sbom.cdx.json> <tarball directory> [<tag>]");
  const tag = tagArgument(tagArg);
  const bom: unknown = JSON.parse(readFileSync(sbom, "utf8"));
  const shipped = shippedIn(dir);
  const findings = checkSbom(bom, shipped, tag);
  if (findings.length > 0) {
    console.error(`SBOM check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  const count = (bom as { components: unknown[] }).components.length;
  console.log(
    `sbom: ${count} components; ${shipped.length} shipped packages at their SHA-512, with every dependency; ` +
      (tag === UNTAGGED
        ? `download URLs name the placeholder tag ${UNTAGGED}, so this SBOM is for no release`
        : `download URLs of ${tag}`),
  );
}
