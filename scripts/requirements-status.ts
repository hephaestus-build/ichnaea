// Generate the requirement status page from the frozen IDs and the files that cite them.
// Run with --check to validate citations without printing the page.
import { lstatSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { trackedFiles } from "./tracked-files.ts";

const requirements = "docs/requirements.md";
const repository = "https://github.com/hephaestus-build/ichnaea";
const citations = /\bREQ-\d+\b/g;
const testFile = /\.test(?:-d)?\.ts$/u;

const sourceLinks = (files: Set<string>) =>
  [...files]
    .toSorted()
    .map((path) => {
      const destination = path.split("/").map(encodeURIComponent).join("/");
      const label = path.replace(/[\\[\]|*_`<>]/g, "\\$&");
      return `[${label}](<${repository}/blob/main/${destination}>)`;
    })
    .join(", ") || "—";

const { values } = parseArgs({ options: { check: { type: "boolean" } } });
const registry = readFileSync(requirements, "utf8");
const ids = [...registry.matchAll(/^\|\s+(REQ-\d+)\s+\|/gm)].map((match) => match[1]!);
if (ids.length === 0 || new Set(ids).size !== ids.length) {
  throw new Error(`${requirements} must define unique requirement IDs`);
}
const entries = new Map(
  ids.map((id) => [id, { tests: new Set<string>(), other: new Set<string>() }]),
);
const problems: string[] = [];
for (const path of new Set(trackedFiles())) {
  if (!lstatSync(path).isFile()) continue;
  const source = path === requirements ? registry : readFileSync(path, "utf8");
  if (!source.includes("REQ-") || source.includes("\0")) continue;
  for (const [index, line] of source.split("\n").entries()) {
    for (const id of new Set(line.match(citations))) {
      const entry = entries.get(id);
      if (entry === undefined) problems.push(`${path}:${index + 1}: unknown requirement ID ${id}`);
      else if (path !== requirements) (testFile.test(path) ? entry.tests : entry.other).add(path);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else if (!values.check) {
  const rows = ids
    .toSorted((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .map((id) => {
      const entry = entries.get(id)!;
      const status =
        entry.tests.size > 0 ? "Test cited" : entry.other.size > 0 ? "Cited" : "No citations";
      return `| ${id} | ${status} | ${sourceLinks(entry.tests)} | ${sourceLinks(entry.other)} |`;
    });
  console.log(
    [
      "---",
      "title: Requirement status",
      "description: Where tests and other files cite the frozen requirements.",
      "editUrl: false",
      "lastUpdated: false",
      "---",
      "",
      `This page indexes citations of the [frozen requirements](${repository}/blob/main/${requirements}).`,
      "A citation points to evidence you can inspect. It does not certify that the requirement is met.",
      "",
      "| Requirement | Status | Test citations | Other citations |",
      "| --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
  );
}
