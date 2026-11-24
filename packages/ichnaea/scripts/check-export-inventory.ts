import { readFileSync } from "node:fs";

import * as z from "zod";

import * as calibration from "../src/calibration/index.ts";
import * as contracts from "../src/contracts/index.ts";
import * as root from "../src/index.ts";
import * as stats from "../src/stats/index.ts";

const Inventory = z.record(z.string(), z.array(z.string()));

/** The runtime namespaces of the supported code subpaths. API Extractor checks their types. */
export const namespaces: Readonly<Record<string, object>> = {
  ".": root,
  "./contracts": contracts,
  "./stats": stats,
  "./calibration": calibration,
};

export function readInventory(): z.infer<typeof Inventory> {
  const json: unknown = JSON.parse(
    readFileSync(new URL("../api/exports.json", import.meta.url), "utf8"),
  );
  return Inventory.parse(json);
}

/** Compare each runtime namespace against the committed inventory in both directions. */
export function exportProblems(
  expected: Readonly<Record<string, readonly string[]>>,
  actual: Readonly<Record<string, object>>,
): string[] {
  const problems: string[] = [];
  for (const subpath of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const listed = new Set(expected[subpath]);
    const loaded = new Set(Object.keys(actual[subpath] ?? {}));
    for (const name of loaded)
      if (!listed.has(name)) problems.push(`${subpath}: unlisted export '${name}'`);
    for (const name of listed)
      if (!loaded.has(name)) problems.push(`${subpath}: missing export '${name}'`);
    if (!Object.hasOwn(expected, subpath)) problems.push(`${subpath}: unlisted subpath`);
    else if (!Object.hasOwn(actual, subpath)) problems.push(`${subpath}: missing subpath`);
  }
  return problems;
}

if (import.meta.main) {
  const problems = exportProblems(readInventory(), namespaces);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
