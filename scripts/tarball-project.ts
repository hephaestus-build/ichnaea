// Installs packed tarballs into a new, empty project: pnpm overrides map every package to its
// tarball, so that the dependencies between them resolve without a registry, and `pnpm add` adds
// each tarball and zod. The release SBOM lists what this project installs.
//
// Run as a script, it checks a released tarball as the release workflow's verify job does: it
// installs the tarball with zod and fails unless the package's bin prints the tag's version.
// Usage: node scripts/tarball-project.ts <directory with the tarball> <tag>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { workspaceZod } from "./readme-example.ts";

/**
 * The project's name. The SBOM names it as its top-level component, so it is a name in the
 * release's own npm scope: an unscoped name such as `ichnaea` is another author's package.
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
 * Creates the project in a temporary directory and installs the tarballs into it. The project is
 * {@link PROJECT} at the tarballs' version, so an SBOM of it describes the release. The caller
 * removes it.
 */
export function installTarballs(dir: string): { project: string; tarballs: Tarball[] } {
  const tarballs = tarballsIn(resolve(dir));
  const versions = new Set(tarballs.map((t) => t.version));
  if (versions.size !== 1) throw new Error(`tarballs have several versions: ${[...versions]}`);
  const root = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
  ) as { packageManager: string };
  const project = mkdtempSync(join(tmpdir(), "ichnaea-tarballs-"));
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
  writeFileSync(
    join(project, "pnpm-workspace.yaml"),
    `overrides:\n${tarballs.map((t) => `  "${t.name}": "file:${t.file}"`).join("\n")}\n`,
  );
  execFileSync("pnpm", ["add", `zod@${workspaceZod()}`, ...tarballs.map((t) => `file:${t.file}`)], {
    cwd: project,
    stdio: "inherit",
  });
  return { project, tarballs };
}

if (import.meta.main) {
  const [dir, tag] = process.argv.slice(2);
  if (!dir || !tag || !/^v0\.\d+\.\d+$/.test(tag))
    throw new Error("usage: tarball-project.ts <directory with the tarball> <v0.x.y tag>");
  const { project, tarballs } = installTarballs(dir);
  try {
    const printed = execFileSync("pnpm", ["exec", "ichnaea", "--version"], {
      cwd: project,
      encoding: "utf8",
    }).trim();
    if (printed !== tag.slice(1)) {
      console.error(
        `ichnaea --version printed ${printed}, not ${tag.slice(1)}, the version of ${tag}`,
      );
      process.exit(1);
    }
    console.log(
      `install: ${tarballs.map((t) => t.name).join(", ")} with zod; ichnaea --version is ${printed}`,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
