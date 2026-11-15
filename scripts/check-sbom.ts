// Fails unless the release SBOM describes what is shipped: every tarball is a component at its
// version with its SHA-512, and every runtime and peer dependency of every tarball is listed.
// Usage: node scripts/check-sbom.ts <sbom.cdx.json> <directory with .tgz files>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { tarballsIn } from "./consumer-project.ts";

export interface Shipped {
  readonly name: string;
  readonly version: string;
  readonly sha512: string;
  readonly dependencies: readonly string[];
}

interface Component {
  readonly name: string;
  readonly group?: string;
  readonly version?: string;
  readonly externalReferences?: ReadonlyArray<{
    readonly type?: string;
    readonly hashes?: ReadonlyArray<{ readonly alg?: string; readonly content?: string }>;
  }>;
}

const isComponent = (c: unknown): c is Component =>
  typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string";

const fullName = (c: Component): string => (c.group ? `${c.group}/${c.name}` : c.name);

/** Returns one finding per way in which the SBOM does not describe the shipped tarballs. */
export function checkSbom(bom: unknown, shipped: readonly Shipped[]): string[] {
  const { bomFormat, components } = (bom ?? {}) as { bomFormat?: unknown; components?: unknown };
  if (bomFormat !== "CycloneDX") return ["the SBOM is not CycloneDX"];
  // CycloneDX may leave out an empty component list.
  if (components === undefined || (Array.isArray(components) && components.length === 0))
    return ["the SBOM lists no components"];
  if (!Array.isArray(components) || !components.every(isComponent))
    return ["the SBOM has no valid component list"];
  const findings: string[] = [];
  const names = new Set(components.map(fullName));
  for (const p of shipped) {
    const own = components.find((c) => fullName(c) === p.name && c.version === p.version);
    if (!own) findings.push(`the SBOM misses the shipped package ${p.name}@${p.version}`);
    else if (
      !own.externalReferences?.some(
        (r) =>
          r.type === "distribution" &&
          r.hashes?.some((h) => h.alg === "SHA-512" && h.content === p.sha512),
      )
    )
      findings.push(`${p.name}@${p.version} in the SBOM does not have the tarball's SHA-512`);
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
    `sbom: ${count} components; ${shipped.length} shipped packages at their SHA-512, with every dependency`,
  );
}
