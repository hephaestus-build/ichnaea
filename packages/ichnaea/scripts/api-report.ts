// Checks the committed API reports, one per subpath of the package, against the declarations of
// the sources. The check emits the declarations to a temporary folder and points API Extractor at
// each subpath's entry there. With --local, it updates the reports instead of failing on a change.
// Usage: node scripts/api-report.ts [--local]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";

/** Each subpath that exports code, its entry under the declarations, and its report's name. */
export const SUBPATHS: ReadonlyArray<{ subpath: string; entry: string; report: string }> = [
  { subpath: ".", entry: "index.d.ts", report: "ichnaea.api.md" },
  { subpath: "./contracts", entry: "contracts/index.d.ts", report: "ichnaea-contracts.api.md" },
  { subpath: "./stats", entry: "stats/index.d.ts", report: "ichnaea-stats.api.md" },
  { subpath: "./node", entry: "node/index.d.ts", report: "ichnaea-node.api.md" },
];

if (import.meta.main) {
  const project = join(import.meta.dirname, "..");
  const config = join(project, "api-extractor.json");
  const out = mkdtempSync(join(tmpdir(), "ichnaea-api-"));
  try {
    execFileSync(
      join(project, "..", "..", "node_modules", ".bin", "tsc"),
      ["-p", "tsconfig.build.json", "--emitDeclarationOnly", "--outDir", out],
      { cwd: project, stdio: "inherit" },
    );
    const stale: string[] = [];
    for (const { subpath, entry, report } of SUBPATHS) {
      const configObject = ExtractorConfig.loadFile(config);
      configObject.mainEntryPointFilePath = join(out, entry);
      configObject.apiReport = {
        ...configObject.apiReport,
        enabled: true,
        reportFileName: report,
        reportTempFolder: out,
      };
      const result = Extractor.invoke(
        ExtractorConfig.prepare({
          configObject,
          configObjectFullPath: config,
          packageJsonFullPath: join(project, "package.json"),
        }),
        { localBuild: process.argv.includes("--local") },
      );
      if (!result.succeeded) stale.push(subpath);
    }
    // The temporary reports that API Extractor names are gone after the check.
    if (stale.length > 0) {
      console.error(
        `the API report of ${stale.join(", ")} is not current: run \`pnpm --filter @hephaestus-build/ichnaea run api\``,
      );
      process.exitCode = 1;
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
