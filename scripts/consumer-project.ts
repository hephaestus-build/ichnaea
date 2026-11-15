// Installs packed tarballs into a new, empty project, as a consumer who follows the README would:
// the README's workspace file and install block, with each release URL changed to its tarball.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { readmeInstall, withTarballs } from "./readme-example.ts";

/**
 * The consumer project's name. The SBOM names it as its top-level component, so it is a name in
 * the release's own npm scope: an unscoped name such as `ichnaea` is another author's package.
 */
export const PROJECT = "@hephaestus-build/ichnaea-release";

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
 * Creates the project in a temporary directory and installs the tarballs into it with the README's
 * install, run as written except for the URLs. The project is {@link PROJECT} at the tarballs'
 * version, so an SBOM of it describes the release. The caller removes it.
 */
export function installAsReadme(dir: string): { project: string; tarballs: Tarball[] } {
  const tarballs = tarballsIn(resolve(dir));
  const versions = new Set(tarballs.map((t) => t.version));
  if (versions.size !== 1) throw new Error(`tarballs have several versions: ${[...versions]}`);
  const repository = join(import.meta.dirname, "..");
  const root = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as {
    packageManager: string;
  };
  const install = readmeInstall(readFileSync(join(repository, "README.md"), "utf8"));
  const files = new Map(
    tarballs.map((t) => [basename(t.file).replace(`-${t.version}.tgz`, ""), t.file]),
  );
  const project = mkdtempSync(join(tmpdir(), "ichnaea-consumer-"));
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: PROJECT,
        version: [...versions][0],
        private: true,
        packageManager: root.packageManager,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(project, "pnpm-workspace.yaml"), withTarballs(install.workspace, files));
  execFileSync("sh", ["-ec", withTarballs(install.commands.join("\n"), files)], {
    cwd: project,
    stdio: "inherit",
  });
  return { project, tarballs };
}
