// The whole path from the CLI: import another runner's results, decide, report. The example
// application is synthetic and uses only published Ichnaea parts (the substitution test).
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "@hephaestus-build/ichnaea-core";
import { describe, expect, it } from "vitest";

const here = join(import.meta.dirname, "..");
const at = (path: string): string => join(here, path);

async function flow(
  candidateResults: string,
): Promise<{ store: string; out: string[]; codes: number[] }> {
  const store = await mkdtemp(join(tmpdir(), "ichnaea-e2e-"));
  const out: string[] = [];
  const log = (t: string): void => void out.push(t);
  const config = ["--config", at("ichnaea.config.ts")];
  const codes = [
    await main(
      [
        "import",
        ...config,
        "--importer",
        "support/results",
        "--suite",
        at("data/suite.json"),
        "--case-set",
        at("data/case-set.json"),
        "--cases",
        at("data/cases.jsonl"),
        "--arm",
        `base:base:${at("configurations/base.json")}`,
        "--arm",
        `candidate:candidate:${at("configurations/candidate.json")}`,
        "--file",
        at("results/base.json"),
        "--file",
        at(candidateResults),
        "--run",
        "run-1",
        "--store",
        store,
        "--now",
        "2026-11-15T10:00:00Z",
        "--seed",
        "7",
      ],
      log,
    ),
    await main(
      ["decide", ...config, "--store", store, "--run", "run-1", "--now", "2026-11-15T11:00:00Z"],
      log,
    ),
    await main(["report", ...config, "--store", store, "--run", "run-1"], log),
  ];
  return { store, out, codes };
}

describe("example application, end to end", () => {
  it("passes when the candidate answers as well as the base", async () => {
    const { store, out, codes } = await flow("results/candidate-same.json");
    expect(codes).toEqual([0, 0, 0]);
    expect(out.join("\n")).toMatch(/PASS/);
    const verdict = JSON.parse(
      await readFile(join(store, "runs", "run-1", "verdict.json"), "utf8"),
    ) as { verdict: string };
    expect(verdict.verdict).toBe("PASS");
  });

  it("blocks a regression and names the broken cases in the report", async () => {
    const { store, codes } = await flow("results/candidate-regressed.json");
    expect(codes[1]).toBe(1);
    const summary = await readFile(join(store, "runs", "run-1", "report", "summary.md"), "utf8");
    expect(summary).toMatch(/REGRESSION/);
    expect(summary).toContain("support-03");
    const html = await readFile(join(store, "runs", "run-1", "report", "report.html"), "utf8");
    expect(html).toContain("Lineage");
  });

  it("the doctor passes: every measure's tester passes", async () => {
    const out: string[] = [];
    expect(
      await main(["doctor", "--config", at("ichnaea.config.ts")], (t) => void out.push(t)),
    ).toBe(0);
    expect(out.join("\n")).toMatch(/support\/facts-stated: tester passed/);
  });
});
