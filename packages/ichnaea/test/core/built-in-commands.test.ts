import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { digest, GateResult, PlanDigest } from "../../src/contracts/index.ts";
import { createHost, createPlan, defineConfig, FileStore, main } from "../../src/index.ts";

import { scenario } from "../decide/support/scenario.ts";

it("plans, decides and reports with a configuration that has no plugins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-core-"));
  try {
    const config = defineConfig({ plugins: [] });
    const host = createHost(config, { core: "0.0.0", contracts: "0.0.0" });
    const configuration = join(directory, "ichnaea.config.ts");
    await writeFile(configuration, 'export default { plugins: [], store: "store" };\n');
    const s = await scenario({ cases: 5, replicates: 1, base: () => 1, candidate: () => 1 });
    const plan = await createPlan({
      suite: { ...s.suite, primary: [], secondary: [], hardGates: [] },
      caseSet: s.caseSet,
      cases: s.cases,
      arms: s.plan.arms,
      measures: host.measures,
      gates: host.gates,
      trigger: s.plan.trigger,
      seed: 0,
      now: s.plan.createdAt,
      ichnaea: s.plan.ichnaea,
    });

    const store = new FileStore(join(directory, "store"));
    await store.createRun({
      plan,
      run: { ...s.run, plan: PlanDigest.parse(digest(plan)) },
      trials: s.trials,
      values: [],
      gates: [],
    });
    const args = ["--config", configuration, "--run", s.run.id];
    const diagnostics: string[] = [];
    const run = (command: string) =>
      main(
        [command, ...args],
        () => undefined,
        undefined,
        (line) => diagnostics.push(line),
      );
    expect(await run("decide"), diagnostics.join("\n")).toBe(0);
    await writeFile(configuration, 'export default { plugins: [], store: "elsewhere" };\n');
    expect(
      await main(["report", ...args, "--store", store.root], () => undefined),
      diagnostics.join("\n"),
    ).toBe(0);
    const stored = await store.read(s.run.id);
    expect(stored.decision).toMatchObject({ mode: "estimate-only", verdict: null });
    const report = await readFile(
      join(store.root, "runs", s.run.id, "report", "summary.md"),
      "utf8",
    );
    expect(report).toContain("ESTIMATE-ONLY");
    // Krippendorff (2011), 12 items in item-major order. The checked-in R oracle runs
    // irr::kripp.alpha(t(matrix), "ordinal") in scripts/stats/reference-agreement.R.
    // Its reference-r-agreement.json entry krippendorff-2011 gives 0.81538750375488134.
    const labels = [
      [1, 1, null, 1],
      [2, 2, 3, 2],
      [3, 3, 3, 3],
      [3, 3, 3, 3],
      [2, 2, 2, 2],
      [1, 2, 3, 4],
      [4, 4, 4, 4],
      [1, 1, 2, 1],
      [2, 2, 2, 2],
      [null, 5, 5, 5],
      [null, null, 1, 1],
      [null, null, 3, null],
    ];
    const ratings = join(directory, "ratings.json");
    await writeFile(
      ratings,
      JSON.stringify({
        metric: "ordinal",
        units: labels.map((raters, index) => ({ item: String(index), stratum: "all", raters })),
      }),
    );
    const output: string[] = [];
    const reportRatings = (...options: string[]) =>
      main(
        ["report", ...args, "--store", store.root, "--ratings", ratings, ...options],
        (line) => output.push(line),
        undefined,
        (line) => diagnostics.push(line),
      );
    expect(await reportRatings("--json"), diagnostics.join("\n")).toBe(0);
    const result: unknown = JSON.parse(output[0] ?? "null");
    expect(result).toMatchObject({
      agreement: {
        statistic: "krippendorff-alpha",
        metric: "ordinal",
        estimate: expect.closeTo(0.81538750375488134, 12),
        counts: {
          items: 12,
          units: 12,
          pairedUnits: 11,
          raters: 4,
          ratings: 41,
          pairedRatings: 40,
        },
        interval: { level: 0.95, lower: expect.any(Number), upper: expect.any(Number) },
      },
    });
    expect(await reportRatings(), diagnostics.join("\n")).toBe(0);
    const rendered = await readFile(
      join(store.root, "runs", s.run.id, "report", "summary.md"),
      "utf8",
    );
    expect(rendered).toContain("Krippendorff’s alpha");
    expect(rendered).toContain("0.8154");
    expect(rendered).toContain("11 of 12");
    for (const [input, message] of [
      ["private-ratings-sentinel", "Cannot read the ratings JSON file."],
      ['{"units":[]}', "The ratings file needs a metric and valid rating units."],
    ] as const) {
      await writeFile(ratings, input);
      output.length = 0;
      diagnostics.length = 0;
      expect(await reportRatings("--json")).toBe(2);
      expect(output).toHaveLength(1);
      expect(diagnostics).toEqual(output);
      expect(JSON.parse(output[0]!)).toEqual({
        schema: "ichnaea.cli.error/1",
        code: "RECORDS",
        message,
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("returns the decision when policy blocks and keeps gate details out of JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-cli-gate-"));
  try {
    const s = await scenario({ cases: 5, replicates: 1, base: () => 1, candidate: () => 1 });
    const gate = GateResult.parse({
      gate: "fixture/test",
      passed: false,
      failures: 1,
      detail: "private-gate-sentinel",
    });
    const plan = {
      ...s.plan,
      hardGates: [gate.gate],
      policy: { ...s.plan.policy, onRegression: "block" as const },
    };
    const store = new FileStore(directory);
    await store.createRun({
      plan,
      run: { ...s.run, plan: PlanDigest.parse(digest(plan)) },
      trials: s.trials,
      values: s.values,
      gates: [gate],
    });
    const args = ["--store", directory, "--run", s.run.id, "--json"];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = (argv: string[]) =>
      main(
        argv,
        (output) => stdout.push(output),
        undefined,
        (error) => stderr.push(error),
      );
    expect(await cli(["decide", ...args]), stderr.join("\n")).toBe(1);
    expect(stdout).toHaveLength(1);
    const decision: unknown = JSON.parse(stdout[0] ?? "");
    expect(decision).toMatchObject({
      schema: "ichnaea.decision/1",
      gates: [{ gate: gate.gate, passed: false }],
    });
    expect(stdout[0]).not.toContain(gate.detail);
    expect(stderr).toEqual([]);
    stdout.length = 0;
    expect(await cli(["report", ...args, "--format", "json"]), stderr.join("\n")).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({ schema: "ichnaea.reportView/1" });
    expect(stdout[0]).not.toContain(gate.detail);
    expect(
      JSON.parse(
        await readFile(join(directory, "runs", s.run.id, "report", "report.json"), "utf8"),
      ),
    ).toEqual(JSON.parse(stdout[0] ?? ""));
    const decidedFile = join(directory, "runs", s.run.id, "decision.json");
    const stored = await store.read(s.run.id);
    await writeFile(
      decidedFile,
      JSON.stringify({ ...stored.decision, reason: "changed since decide" }),
    );
    stdout.length = 0;
    expect(await cli(["report", ...args])).toBe(2);
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({ code: "RECOMPUTE_MISMATCH" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
