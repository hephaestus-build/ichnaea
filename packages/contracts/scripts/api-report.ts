// Checks the committed API report against the declarations of the sources. The packages ship
// TypeScript sources and have no build, so the check emits the declarations to a temporary folder
// and points API Extractor at it. With --local, it updates the report instead of failing on a
// change. Usage: node scripts/api-report.ts [--local]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";

const project = join(import.meta.dirname, "..");
const config = join(project, "api-extractor.json");
const out = mkdtempSync(join(tmpdir(), "ichnaea-contracts-api-"));
try {
  execFileSync(
    join(project, "..", "..", "node_modules", ".bin", "tsc"),
    ["-p", "tsconfig.build.json", "--emitDeclarationOnly", "--outDir", out],
    { cwd: project, stdio: "inherit" },
  );
  const configObject = ExtractorConfig.loadFile(config);
  configObject.mainEntryPointFilePath = join(out, "index.d.ts");
  configObject.apiReport = { ...configObject.apiReport, enabled: true, reportTempFolder: out };
  const result = Extractor.invoke(
    ExtractorConfig.prepare({
      configObject,
      configObjectFullPath: config,
      packageJsonFullPath: join(project, "package.json"),
    }),
    { localBuild: process.argv.includes("--local") },
  );
  // The temporary report that API Extractor names is gone after the check.
  if (!result.succeeded) {
    console.error(
      "the API report is not current: run `pnpm --filter ./packages/contracts run api`",
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
