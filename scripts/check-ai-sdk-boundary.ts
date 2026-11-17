// The Vercel AI SDK may be imported only in adapter packages.
import { readFileSync } from "node:fs";

import { trackedFiles } from "./tracked-files.ts";

const ADAPTER = /^packages\/(judge-aisdk|otel)\//;
const files = trackedFiles(["packages"]).filter(
  (f) => /\.(ts|tsx|json)$/.test(f) && !ADAPTER.test(f),
);
const offenders = files.filter((f) =>
  /from\s+["'](ai|@ai-sdk\/[^"']+)["']|"(ai|@ai-sdk\/[^"]+)"\s*:/.test(readFileSync(f, "utf8")),
);
if (offenders.length > 0) {
  console.error(`AI SDK imported outside adapter packages:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.log(`ai-sdk boundary: ${files.length} files clean`);
