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
      seed: Number(s.plan.seed.value),
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
