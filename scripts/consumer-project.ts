// Installs packed tarballs into a new, empty project, as a consumer would: every Ichnaea package
// maps to its tarball, so dependencies between them resolve without a registry.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TARBALL = /^hephaestus-build-(.+)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/;

export interface Tarball {
  readonly file: string;
  readonly name: string;
  readonly version: string;
}

/** The tarballs in a directory, named as `pnpm pack` names them. */
export function tarballsIn(dir: string): Tarball[] {
  const tarballs = readdirSync(dir)
    .filter((f) => f.endsWith(".tgz"))
    .map((file) => {
      const match = TARBALL.exec(file);
      if (!match) throw new Error(`${file} is not a packed Ichnaea package`);
      return { file: join(dir, file), name: `@hephaestus-build/${match[1]}`, version: match[2]! };
    });
  if (tarballs.length === 0) throw new Error(`no tarballs in ${dir}`);
  return tarballs;
}

/**
 * The zod version that the workspace builds and tests with: the contracts package's development
 * dependency. A consumer installs the same version.
 */
export function workspaceZod(): string {
  const contracts = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "packages", "contracts", "package.json"), "utf8"),
  ) as { devDependencies: { zod: string } };
  return contracts.devDependencies.zod;
}

/**
 * Creates the project in a temporary directory and installs the tarballs into it. The project is
 * `ichnaea` at the tarballs' version, so an SBOM of it describes the release. The caller removes it.
 */
export function installTarballs(dir: string): { project: string; tarballs: Tarball[] } {
  const tarballs = tarballsIn(resolve(dir));
  const versions = new Set(tarballs.map((t) => t.version));
  if (versions.size !== 1) throw new Error(`tarballs have several versions: ${[...versions]}`);
  const root = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
  ) as {
    packageManager: string;
  };
  const overrides = Object.fromEntries(tarballs.map((t) => [t.name, `file:${t.file}`]));
  const project = mkdtempSync(join(tmpdir(), "ichnaea-consumer-"));
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "ichnaea",
        version: [...versions][0],
        private: true,
        type: "module",
        packageManager: root.packageManager,
        dependencies: { ...overrides, zod: workspaceZod() },
      },
      null,
      2,
    ),
  );
  // pnpm reads overrides from the workspace file.
  writeFileSync(
    join(project, "pnpm-workspace.yaml"),
    `overrides:\n${Object.entries(overrides)
      .map(([k, v]) => `  "${k}": "${v}"`)
      .join("\n")}\n`,
  );
  execFileSync("pnpm", ["install"], { cwd: project, stdio: "inherit" });
  return { project, tarballs };
}
