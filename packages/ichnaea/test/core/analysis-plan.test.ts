import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { expect, it } from "vitest";

import { digest } from "../../src/contracts/canonical.ts";
import { loadConfig, main } from "../../src/cli.ts";
import { CORE_VERSION, createHost, defaultBlocks, FileStore, planSuite } from "../../src/index.ts";

import { card } from "../decide/support/scenario.ts";

it("locks applicability and keeps a candidate change out of the analysis plan digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-plan-"));
  try {
    await writeFile(
      join(directory, "cases.jsonl"),
      [
        { id: "a", input: { answer: "one" } },
        { id: "b", input: { answer: "two" } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n"),
    );
    const configPath = (candidate: string) => join(directory, `${candidate}.ts`);
    const writeConfig = (candidate: string) =>
      writeFile(
        configPath(candidate),
        `
        export default {
          suite: {
            id: "answers", cases: "cases.jsonl", primary: ["app/correct"],
            caseDefaults: {
              unit: "turn", dataClass: "none", pool: "development",
              provenance: { source: "authored", selection: "curated", created: "2026-11-24",
                exposure: "private", licence: "CC0-1.0" },
            },
            arms: { base: { model: "original" }, candidate: { model: ${JSON.stringify(candidate)} } },
            objective: "Compare answers", construct: "Accuracy", decision: "Release",
            scope: "Short answers", nonCoverage: ["Long answers"],
          },
          plugins: [{ id: "app", version: "1.0.0", measures: [{
            ...${JSON.stringify(card("app/correct"))},
            appliesTo: (c) => c.id === "a",
          }], importers: [{
            id: "app/results", version: "1.0.0", description: "Synthetic results",
            async run({ plan }) {
              const noise = plan.arms[0].identity === plan.arms[1].identity;
              const trials = plan.trials.map((trial) => ({
                schema: "ichnaea.trial/1", id: trial.id, source: "offline",
                case: trial.case, arm: trial.arm, replicate: trial.replicate,
                configuration: plan.arms.find((arm) => arm.name === trial.arm).identity,
                unit: "turn",
                outcome: noise && trial.case === "a"
                  ? (trial.replicate % 2 === 0 ? "system_failure" : "budget_exceeded")
                  : "completed",
                dataClass: "none", output: "answer",
              }));
              const values = trials.filter((trial) => trial.outcome === "completed").map((trial) => {
                const applicable = !(trial.case === "a" && trial.arm === "candidate");
                return {
                  schema: "ichnaea.measureValue/1", trial: trial.id, measure: "app/correct",
                  version: "1.0.0", source: "application", dataClass: "none", applicable,
                  ...(applicable ? { value: { type: "binary", pass: true } } : {}),
                };
              });
              return { trials, values };
            },
          }] }],
        };
      `,
      );
    const diagnostics: string[] = [];
    const output: string[] = [];
    const plan = (candidate: string, ...flags: string[]) =>
      main(
        ["plan", "--config", configPath(candidate), ...flags],
        (line) => output.push(line),
        undefined,
        (line) => diagnostics.push(line),
      );
    const read = async (): Promise<unknown> =>
      JSON.parse(await readFile(join(directory, "plan.json"), "utf8"));

    await writeConfig("candidate-1");
    expect(await plan("candidate-1"), diagnostics.join("\n")).toBe(0);
    const before = await read();
    expect(output[0]).toMatch(
      /^plan: 2 cases, 6 blocks, 24 calls .*(detects a drop|power if every candidate trial fails)/,
    );
    expect(before).toMatchObject({
      blocks: 6,
      replicates: 1,
      holm: ["app/correct"],
      applicability: { "app/correct": ["a"] },
    });
    await expect(readFile(join(directory, "ichnaea.lock"), "utf8")).resolves.toContain("a");

    const loaded = await loadConfig(configPath("candidate-1"));
    if (!loaded.suite) throw new Error("expected the configured suite");
    const library = await planSuite({
      suite: loaded.suite,
      host: createHost(loaded, { core: CORE_VERSION, contracts: CORE_VERSION }),
      directory,
      ichnaea: CORE_VERSION,
    });
    expect(digest(library.plan)).toBe(digest(before));

    const largerHorizon = await planSuite({
      suite: { ...loaded.suite, primary: [{ measure: "app/correct", targetDrop: 1 }] },
      host: createHost(loaded, { core: CORE_VERSION, contracts: CORE_VERSION }),
      directory,
      ichnaea: CORE_VERSION,
    });
    expect(largerHorizon.plan.blocks).toBeGreaterThan(library.plan.blocks);
    expect(largerHorizon.plan.resolution?.[0]?.powerAtTarget).toBeGreaterThanOrEqual(0.8);

    await writeConfig("candidate-2");
    expect(await plan("candidate-2", "--frozen"), diagnostics.join("\n")).toBe(0);
    expect(digest(await read())).toBe(digest(before));
    const store = new FileStore(join(directory, "store"));
    const run = "imported";
    const cli = (...args: string[]) =>
      main(
        args,
        () => undefined,
        undefined,
        (line) => diagnostics.push(line),
      );
    expect(
      await cli(
        "import",
        "--config",
        configPath("candidate-2"),
        "--plan",
        join(directory, "plan.json"),
        "--importer",
        "app/results",
        "--run",
        run,
        "--store",
        store.root,
        "--trigger",
        "new-model",
      ),
      diagnostics.join("\n"),
    ).toBe(0);
    expect(await cli("decide", "--run", run, "--store", store.root), diagnostics.join("\n")).toBe(
      0,
    );
    const stored = await store.read(run);
    expect(stored.run.exploratory).toBe(true);
    expect(stored.plan.analysis?.applicability).toEqual({ "app/correct": ["a"] });
    expect(stored.decision?.verdict).toBeNull();
    expect(stored.decision?.resolution).toEqual([
      expect.objectContaining({
        measure: "app/correct",
        basis: "base-arm-rates",
        targetPower: 0.8,
        result: expect.objectContaining({
          kind: expect.stringMatching(/^(detectable-drop|extreme)$/),
        }),
      }),
    ]);
    await expect(
      planSuite({
        suite: loaded.suite,
        host: createHost(loaded, { core: CORE_VERSION, contracts: CORE_VERSION }),
        directory,
        ichnaea: CORE_VERSION,
        pilot: stored,
      }),
    ).rejects.toThrow("the pilot must compare this base with itself");
    const measure = stored.decision?.measures[0];
    expect(measure?.arms).toMatchObject([
      { arm: "base", availability: { planned: 6, available: 6, missing: 0, notApplicable: 6 } },
      {
        arm: "candidate",
        availability: { planned: 6, available: 0, missing: 6, notApplicable: 6 },
      },
    ]);
    expect(measure?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("APPLICABILITY_CONTRADICTS_PLAN"),
        "ignored 12 value(s) outside the planned applicability mask",
      ]),
    );

    await writeConfig("original");
    const importPlanned = (candidate: string, runName: string) =>
      cli(
        "import",
        "--config",
        configPath(candidate),
        "--plan",
        join(directory, "plan.json"),
        "--importer",
        "app/results",
        "--run",
        runName,
        "--store",
        store.root,
        "--trigger",
        "new-model",
      );
    expect(await importPlanned("original", "noise"), diagnostics.join("\n")).toBe(0);
    const pilot = await store.read("noise");
    expect(pilot.values.some((value) => value.trial.startsWith("a/"))).toBe(false);
    expect(
      await plan("candidate-2", "--pilot", "noise", "--store", store.root),
      diagnostics.join("\n"),
    ).toBe(0);
    const withPilot = await read();
    expect(withPilot).toMatchObject({
      pilot: { run: "noise", digest: digest(pilot.run) },
      resolution: [
        {
          measure: "app/correct",
          basis: "noise-pilot",
          result: { kind: "extreme", power: 0 },
        },
      ],
    });
    expect(
      await plan("candidate-2", "--frozen", "--store", store.root),
      diagnostics.join("\n"),
    ).toBe(0);
    expect(await importPlanned("candidate-2", "with-pilot"), diagnostics.join("\n")).toBe(0);
    expect(
      await cli("decide", "--run", "with-pilot", "--store", store.root),
      diagnostics.join("\n"),
    ).toBe(0);
    expect((await store.read("with-pilot")).decision?.resolution).toEqual([
      expect.objectContaining({
        measure: "app/correct",
        basis: "noise-pilot",
        result: { kind: "extreme", power: 0 },
      }),
    ]);

    await writeFile(
      join(directory, "cases.jsonl"),
      JSON.stringify({ id: "a", input: { answer: "changed" } }),
    );
    expect(await plan("candidate-2", "--frozen", "--store", store.root)).toBe(2);
    expect(digest(await read())).toBe(digest(withPilot));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("adds one block to the smallest horizon that can reject at alpha over the family", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.double({ min: 0.01, max: 0.2, noNaN: true }),
      (family, alpha) => {
        const minimum = defaultBlocks(family, alpha) - 1;
        expect(2 ** -minimum).toBeLessThanOrEqual(alpha / family);
        expect(2 ** -(minimum - 1)).toBeGreaterThan(alpha / family);
      },
    ),
  );
});
