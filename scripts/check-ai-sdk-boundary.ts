// The Vercel AI SDK may be imported only in adapter packages.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ADAPTER = /^packages\/(judge-aisdk|otel)\//;
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "packages"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((f) => existsSync(f) && /\.(ts|tsx|json)$/.test(f) && !ADAPTER.test(f));
const offenders = files.filter((f) =>
  /from\s+["'](ai|@ai-sdk\/[^"']+)["']|"(ai|@ai-sdk\/[^"]+)"\s*:/.test(readFileSync(f, "utf8")),
);
if (offenders.length > 0) {
  console.error(`AI SDK imported outside adapter packages:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.log(`ai-sdk boundary: ${files.length} files clean`);
