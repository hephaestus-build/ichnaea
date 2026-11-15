// Writes the release SBOM (CycloneDX JSON) from what is shipped: it installs the tarballs into an
// empty project, as a consumer would, and lets pnpm list that project's production dependencies.
// Usage: node scripts/release-sbom.ts <directory with .tgz files> <output file>
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

import { installTarballs } from "./consumer-project.ts";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("usage: release-sbom.ts <tarball directory> <output file>");
const { project } = installTarballs(dir);
try {
  const sbom = execFileSync("pnpm", ["sbom", "--sbom-format", "cyclonedx", "--prod"], {
    cwd: project,
    encoding: "utf8",
  });
  writeFileSync(out, sbom);
} finally {
  rmSync(project, { recursive: true, force: true });
}
