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

  it.each(workflows)("%s caps every matrix at the plan's max-parallel, 12 by default", (name) => {
    const text = readFileSync(
      join(import.meta.dirname, "..", ".github", "workflows", name),
      "utf8",
    );
    const matrices = text.split("matrix: ${{ fromJSON(").length - 1;
    const capped =
      text.split("max-parallel: ${{ fromJSON(needs.plan.outputs.max_parallel) }}").length - 1;
    expect(matrices).toBeGreaterThan(0);
    expect(capped).toBe(matrices);
    expect(text).toMatch(/\n {6}max_parallel:\n[^\n]*\n {8}type: string\n {8}default: "12"\n/);
  });

  it.each(workflows)("%s shares one concurrency group with every heavy workflow", (name) => {
    const text = readFileSync(
      join(import.meta.dirname, "..", ".github", "workflows", name),
      "utf8",
    );
    expect(text).toMatch(
      /\nconcurrency:\n {2}group: heavy-runners\n {2}cancel-in-progress: false\n/,
    );
  });

  it("runs the sweep's matrices one after another", () => {
    const text = readFileSync(
      join(import.meta.dirname, "..", ".github", "workflows", "confirmation-sweep.yml"),
      "utf8",
    );
    const jobs = text.slice(text.indexOf("\njobs:\n"));
    const blocks = jobs.split(/\n(?= {2}[a-z_-]+:\n)/).slice(1);
    const needs = new Map<string, string[]>();
    const matrices: string[] = [];
    for (const block of blocks) {
      const name = /^ {2}([a-z_-]+):/.exec(block)?.[1] ?? "";
      const list = /\n {4}needs: (?:\[([^\]]*)\]|([a-z_-]+))\n/.exec(block);
      needs.set(
        name,
        (list?.[1] ?? list?.[2] ?? "")
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean),
      );
      if (block.includes("matrix: ${{ fromJSON(")) matrices.push(name);
    }
    const after = (job: string, earlier: string): boolean =>
      (needs.get(job) ?? []).some((n) => n === earlier || after(n, earlier));
    expect(matrices).toEqual(["exact", "skips", "large", "embedded"]);
    for (const [i, a] of matrices.entries())
      for (const b of matrices.slice(i + 1)) expect(after(b, a), `${b} after ${a}`).toBe(true);
  });
});
