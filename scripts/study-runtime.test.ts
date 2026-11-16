// The study workflows run every job on one runtime (REQ-83): one runner image label, x64 Linux, and
// one pinned Node version, so that their outputs can be compared byte for byte.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflows = ["stats-study.yml", "confirmation-sweep.yml"];

describe("the study workflows", () => {
  it.each(workflows)("%s runs every job on ubuntu-24.04 with one pinned Node version", (name) => {
    const text = readFileSync(
      join(import.meta.dirname, "..", ".github", "workflows", name),
      "utf8",
    );
    const labels = [...text.matchAll(/^ {4}runs-on: (.+)$/gm)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels)).toEqual(new Set(["ubuntu-24.04"]));
    expect(text).toMatch(/\n {2}NODE_VERSION: 24\.22\.2\n/);
  });

  it.each(workflows)("%s caps every matrix at the plan's max-parallel, 20 by default", (name) => {
    const text = readFileSync(
      join(import.meta.dirname, "..", ".github", "workflows", name),
      "utf8",
    );
    const matrices = text.split("matrix: ${{ fromJSON(").length - 1;
    const capped =
      text.split("max-parallel: ${{ fromJSON(needs.plan.outputs.max_parallel) }}").length - 1;
    expect(matrices).toBeGreaterThan(0);
    expect(capped).toBe(matrices);
    expect(text).toMatch(/\n {6}max_parallel:\n[^\n]*\n {8}type: string\n {8}default: "20"\n/);
  });
});
