// Checks an SBOM against what is shipped.
//
// The build SBOM of a build tree (`--build <tree>`): it is CycloneDX, its top-level component is
// the package at its version, it names the source commit, its timestamp is the source commit's
// committer date and its serial number derives from the source commit, it lists every peer
// dependency, its lists are sorted, and it holds no path on the build machine.
//
// The release SBOM: its top-level component is the release project in the release's npm scope,
// every tarball is a component at its version with its SHA-512 and the URL that the npm registry
// serves it from, and every runtime and peer dependency of every tarball is listed.
// Usage: node scripts/check-sbom.ts --build <build tree>
//        node scripts/check-sbom.ts <sbom.cdx.json> <directory with .tgz files>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { BUILD_INFO, commitDate, SBOM, type BuildInfo } from "./build-package.ts";
import { PROJECT, registryUrl, tarballsIn } from "./tarball-project.ts";
import { buildSerialNumber } from "./release-sbom.ts";

export interface Shipped {
  /** The tarball's file name, as `pnpm pack` writes it. */
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
 * Returns one finding per way in which the SBOM does not describe the shipped tarballs of a
 * release. `project` is the name of the top-level component, which has the version of the
 * tarballs.
 */
export function checkSbom(bom: unknown, shipped: readonly Shipped[], project = PROJECT): string[] {
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
      // A consumer installs the tarball from the registry, not from a path on the build machine.
      const url = registryUrl(p.name, p.version);
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

/** An SBOM item's `bom-ref`, or a dependency's `ref`. */
const refOf = (item: object): string => {
  const { "bom-ref": bomRef, ref } = item as { "bom-ref"?: unknown; ref?: unknown };
  return String(bomRef ?? ref);
};

/** Whether a list is sorted by its items' `bom-ref` or `ref`. */
const sortedByRef = (items: readonly object[]): boolean =>
  items.every((item, i) => i === 0 || refOf(items[i - 1]!) <= refOf(item));

/** The string values of a JSON value. */
const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "object" && value !== null
      ? Object.values(value).flatMap(strings)
      : [];

/**
 * Returns one finding per way in which a build SBOM does not describe the build of `pkg` from the
 * source commit, whose committer date is `date`.
 */
export function checkBuildSbom(
  bom: unknown,
  pkg: { name: string; version: string; peerDependencies?: Readonly<Record<string, string>> },
  sourceCommit: string,
  date: string,
): string[] {
  const { bomFormat, serialNumber, metadata, components, dependencies } = (bom ?? {}) as {
    bomFormat?: unknown;
    serialNumber?: unknown;
    metadata?: { timestamp?: unknown; component?: unknown };
    components?: unknown;
    dependencies?: unknown;
  };
  if (bomFormat !== "CycloneDX") return ["the SBOM is not CycloneDX"];
  const findings: string[] = [];
  const serial = buildSerialNumber(sourceCommit);
  if (serialNumber !== serial) findings.push(`the SBOM's serial number is not ${serial}`);
  if (metadata?.timestamp !== date) findings.push(`the SBOM's timestamp is not ${date}`);
  const root = metadata?.component;
  const purl = npmPurl(pkg.name, pkg.version);
  if (
    !isComponent(root) ||
    fullName(root) !== pkg.name ||
    root.version !== pkg.version ||
    root.purl !== purl
  )
    findings.push(`the SBOM's top-level component is not ${purl}`);
  else if (
    !(root.externalReferences ?? []).some(
      (r) => r.type === "vcs" && r.url?.endsWith(`#${sourceCommit}`),
    )
  )
    findings.push(`the SBOM's top-level component does not name the source commit ${sourceCommit}`);
  if (!Array.isArray(components) || !components.every(isComponent))
    return [...findings, "the SBOM has no valid component list"];
  const names = new Set(components.map(fullName));
  for (const d of Object.keys(pkg.peerDependencies ?? {}))
    if (!names.has(d)) findings.push(`the SBOM misses ${d}, a peer dependency of ${pkg.name}`);
  if (!sortedByRef(components)) findings.push("the SBOM's components are not sorted");
  if (!Array.isArray(dependencies) || !sortedByRef(dependencies as object[]))
    findings.push("the SBOM's dependencies are not sorted");
  for (const s of strings(bom))
    if (s.startsWith("file:") || /^\/(?!\/)/.test(s))
      findings.push(`the SBOM has a path on the build machine: ${s}`);
  return findings;
}

/** Checks the SBOM of a build tree against the tree's manifest and build.json. */
export function checkBuildTree(tree: string): string[] {
  if (!existsSync(join(tree, SBOM))) return [`the build tree has no ${SBOM}`];
  const bom: unknown = JSON.parse(readFileSync(join(tree, SBOM), "utf8"));
  const pkg = JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as {
    name: string;
    version: string;
    peerDependencies?: Record<string, string>;
  };
  const { sourceCommit } = JSON.parse(readFileSync(join(tree, BUILD_INFO), "utf8")) as BuildInfo;
  return checkBuildSbom(bom, pkg, sourceCommit, commitDate(sourceCommit));
}

if (import.meta.main && process.argv[2] === "--build") {
  const tree = process.argv[3];
  if (!tree) throw new Error("usage: check-sbom.ts --build <build tree>");
  const findings = checkBuildTree(tree);
  if (findings.length > 0) {
    console.error(`SBOM check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`sbom: ${join(tree, SBOM)} describes the build of its source commit`);
} else if (import.meta.main) {
  const [sbom, dir] = process.argv.slice(2);
  if (!sbom || !dir) throw new Error("usage: check-sbom.ts <sbom.cdx.json> <tarball directory>");
  const bom: unknown = JSON.parse(readFileSync(sbom, "utf8"));
  const shipped = shippedIn(dir);
  const findings = checkSbom(bom, shipped);
  if (findings.length > 0) {
    console.error(`SBOM check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  const count = (bom as { components: unknown[] }).components.length;
  console.log(
    `sbom: ${count} components; ${shipped.length} shipped packages at their SHA-512 and registry ` +
      "URL, with every dependency",
  );
}
