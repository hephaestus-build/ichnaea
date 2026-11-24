import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { digest, PlanDigest } from "../../src/contracts/index.ts";
import { createHost, createPlan, defineConfig, FileStore, main } from "../../src/index.ts";

import { scenario } from "../decide/support/scenario.ts";

it("plans, decides and reports with a configuration that has no plugins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-core-"));
  try {
    const config = defineConfig({ plugins: [] });
    const host = createHost(config, { core: "0.0.0", contracts: "0.0.0" });
    const configuration = join(directory, "ichnaea.config.ts");
    await writeFile(configuration, "export default { plugins: [] };\n");
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
    const args = ["--config", configuration, "--store", store.root, "--run", s.run.id];
    const diagnostics: string[] = [];
    const run = (command: string) =>
      main(
        [command, ...args],
        () => undefined,
        undefined,
        (line) => diagnostics.push(line),
      );
    expect(await run("decide"), diagnostics.join("\n")).toBe(0);
    expect(await run("report"), diagnostics.join("\n")).toBe(0);
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
        ["report", ...args, "--ratings", ratings, ...options],
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
