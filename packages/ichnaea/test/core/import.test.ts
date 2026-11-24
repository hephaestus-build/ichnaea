// REQ-15, REQ-17, REQ-19, REQ-22, REQ-31, REQ-52: import mode checks every record before it stores
// anything, and stores the run atomically.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GateResult, MeasureValue, Trial } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide } from "../../src/decide/index.ts";
import { card, scenario } from "../decide/support/scenario.ts";
import {
  createHost,
  FileStore,
  type GateDefinition,
  type ImportResult,
  importRun,
  type MeasureDefinition,
  NOT_CAPTURED,
  type Plugin,
} from "../../src/core/index.ts";

const versions = { core: "0.0.0", contracts: "0.0.0" };

/** A trial turned into a protocol failure with no output, changed further by `change`. */
function failed(t: Trial, change: Partial<Trial>): Trial {
  const { output: _output, ...rest } = t;
  return { ...rest, ...change, outcome: "protocol_failure", error: { kind: "bad-request" } };
}

/** Writes a scenario's inputs to files and returns an import over a scripted importer. */
async function setup(
  result: (trials: Trial[], values: MeasureValue[]) => ImportResult,
  extra: {
    measures?: MeasureDefinition<`app/${string}`>[];
    gates?: GateDefinition<`app/${string}`>[];
    hardGates?: `app/${string}`[];
  } = {},
) {
  const s = await scenario({
    cases: 6,
    replicates: 2,
    base: () => 1,
    candidate: () => 1,
    hardGates: extra.hardGates ?? [],
  });
  const dir = await mkdtemp(join(tmpdir(), "ichnaea-import-"));
  const file = (name: string, value: unknown): Promise<void> =>
    writeFile(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
  await file("suite.json", s.suite);
  await file("case-set.json", s.caseSet);
  await file("cases.jsonl", s.cases.map((c) => JSON.stringify(c)).join("\n"));
  for (const a of s.plan.arms) await file(`${a.name}.json`, a.configuration);
  const plugin: Plugin = {
    id: "app",
    version: "1.0.0",
    measures: extra.measures ?? [card("app/correct") as MeasureDefinition<`app/${string}`>],
    gates:
      extra.gates ??
      (extra.hardGates ?? []).map((id) => ({ id, version: "1.0.0", description: "a check" })),
    importers: [
      {
        id: "app/runner",
        version: "2.0.0",
        description: "d",
        run: async () => result(s.trials, s.values),
      },
    ],
  };
  const host = createHost({ plugins: [plugin] }, versions);
  const store = join(dir, "store");
  const go = () =>
    importRun({
      host,
      store,
      run: "run-1",
      importer: "app/runner",
      suite: join(dir, "suite.json"),
      caseSet: join(dir, "case-set.json"),
      cases: join(dir, "cases.jsonl"),
      arms: s.plan.arms.map((a) => ({
        name: a.name,
        role: a.role,
        configuration: join(dir, `${a.name}.json`),
      })),
      files: [],
      trigger: "code",
      seed: 7,
      now: "2026-11-15T10:00:00Z",
      ichnaea: "0.0.0",
    });
  return { s, go, store };
}

describe("import mode", () => {
  it("stores plan, trials, values, gates and a run whose ledger lists every planned trial", async () => {
    const { go, store, s } = await setup((trials, values) => ({
      trials: trials.slice(1),
      values: values.filter((v) => v.trial !== trials[0]?.id),
    }));
    const result = await go();
    expect(result.trials).toBe(s.plan.trials.length - 1);
    const stored = await new FileStore(store).read("run-1");
    expect(stored.run.ledger).toHaveLength(s.plan.trials.length);
    expect(stored.run.ledger[0]).toEqual({
      trial: s.plan.trials[0]?.id,
      state: "planned",
      outcome: "not_run",
    });
    expect(stored.run.ledger[1]).toMatchObject({ state: "recorded", outcome: "completed" });
    expect(stored.run.lineage).toContainEqual({
      kind: "plugin",
      id: "app/runner",
      version: "2.0.0",
    });
    expect(stored.run.lineage.find((l) => l.kind === "measure")?.digest).toMatch(/^sha256:/);
    expect(stored.run.environment).toMatchObject({
      arch: process.arch,
      runtime: {
        name: "node",
        version: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
    });
  });

  it("refuses an unplanned trial, or one whose case, arm or replicate differs from its plan, and stores nothing", async () => {
    const stray = await setup((trials, values) => ({
      trials: [...trials, { ...(trials[0] as Trial), id: "stray" as Trial["id"] }],
      values,
    }));
    await expect(stray.go()).rejects.toThrow(
      "the importer returned trial 'stray', which the plan does not list",
    );
    await expect(new FileStore(stray.store).runs()).resolves.toEqual([]);
    const moved = await setup((trials, values) => ({
      trials: trials.map((t, i) => (i === 0 ? { ...t, replicate: 1 } : t)),
      values,
    }));
    await expect(moved.go()).rejects.toThrow(
      /is planned as case 'case-000', arm 'base', replicate 0/,
    );
  });

  it("marks a trial of another configuration, or with an unexpected observation, as an invalid configuration (REQ-15)", async () => {
    const { go, store } = await setup((trials, values) => ({
      trials: trials.map((t, i) =>
        i === 0
          ? { ...t, configuration: `sha256:${"9".repeat(64)}` as Trial["configuration"] }
          : i === 1
            ? { ...t, observed: [{ name: "model", value: "m-2", expected: "m-1" }] }
            : t,
      ),
      values,
    }));
    await go();
    const stored = await new FileStore(store).read("run-1");
    expect(stored.trials[0]).toMatchObject({
      outcome: "invalid_configuration",
      error: { kind: "configuration-mismatch" },
    });
    expect(stored.trials[1]?.error?.message).toBe("observed model differs from the expected value");
    // Their values are not stored: an invalid configuration is missing.
    expect(stored.values.some((v) => v.trial === stored.trials[0]?.id)).toBe(false);
  });

  it("keeps a protocol failure whatever its configuration, so the run stays INVALID", async () => {
    const { go, store } = await setup((trials, values) => {
      return {
        trials: trials.map((t, i) =>
          i === 0
            ? failed(t, { configuration: `sha256:${"9".repeat(64)}` as Trial["configuration"] })
            : i === 1
              ? failed(t, { observed: [{ name: "model", value: "m-2", expected: "m-1" }] })
              : t,
        ),
        values: values.filter((v) => v.trial !== trials[0]?.id && v.trial !== trials[1]?.id),
      };
    });
    await go();
    const stored = await new FileStore(store).read("run-1");
    for (const t of stored.trials.slice(0, 2))
      expect(t).toMatchObject({ outcome: "protocol_failure", error: { kind: "bad-request" } });
    const decision = decide({ ...stored, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
    expect(decision.verdict).toBe("INVALID");
    expect(decision.invalidReasons).toContain(
      "a worker reported a protocol failure (bad-request): the harness, not the system, failed",
    );
  });

  it("makes a completed record without captured output a capture failure, counted as missing (REQ-20)", async () => {
    const { go, store } = await setup((trials, values) => ({
      trials: trials.map((t, i) => {
        if (i !== 0) return t;
        const { output: _output, ...rest } = t;
        return rest as Trial;
      }),
      values,
    }));
    await go();
    const stored = await new FileStore(store).read("run-1");
    expect(stored.trials[0]).toMatchObject({
      outcome: "infrastructure_failure",
      error: { kind: NOT_CAPTURED, message: "the record has no captured output" },
    });
    expect(stored.run.ledger[0]).toMatchObject({ outcome: "infrastructure_failure" });
    // An output the system returned empty was captured, so it stays completed.
    const empty = await setup((trials, values) => ({
      trials: trials.map((t, i) => (i === 0 ? { ...t, output: "" } : t)),
      values,
    }));
    await empty.go();
    expect((await new FileStore(empty.store).read("run-1")).trials[0]?.outcome).toBe("completed");
  });

  it("refuses a system failure that carries a passing value (REQ-20)", async () => {
    const { go, store } = await setup((trials, values) => ({
      trials: trials.map((t, i) => (i === 0 ? { ...t, outcome: "system_failure" } : t)),
      values: values.map((v) =>
        v.trial === trials[0]?.id
          ? ({ ...v, value: { type: "binary", pass: true } } as MeasureValue)
          : v,
      ),
    }));
    await expect(go()).rejects.toThrow(
      "trial 'case-000/base/r0' is a system_failure but carries a passing value for 'app/correct'; a failed trial cannot pass, so fix the importer",
    );
    await expect(new FileStore(store).runs()).resolves.toEqual([]);
  });

  it("checks every imported value against its card (REQ-31)", async () => {
    const withValue = (change: (v: MeasureValue) => MeasureValue) =>
      setup((trials, values) => ({
        trials,
        values: values.map((v, i) => (i === 0 ? change(v) : v)),
      }));
    await expect(
      (await withValue((v) => ({ ...v, measure: "app/other" as MeasureValue["measure"] }))).go(),
    ).rejects.toThrow("value for measure 'app/other', which the plan does not use");
    await expect((await withValue((v) => ({ ...v, version: "2.0.0" }))).go()).rejects.toThrow(
      /has version 2\.0\.0, but the card is 1\.0\.0/,
    );
    await expect(
      (await withValue((v) => ({ ...v, value: { type: "score", value: 1 } }) as MeasureValue)).go(),
    ).rejects.toThrow(/is score, but the card says binary \(REQ-31\)/);
    await expect(
      (await withValue((v) => ({ ...v, trial: "nowhere" as MeasureValue["trial"] }))).go(),
    ).rejects.toThrow("names trial 'nowhere', which was not imported");
    const twice = await setup((trials, values) => ({
      trials,
      values: [...values, values[0] as MeasureValue],
    }));
    await expect(twice.go()).rejects.toThrow(/duplicate measure value/);
  });

  it("refuses imported values of a measure Ichnaea computes", async () => {
    const s = await scenario({ cases: 6, replicates: 2, base: () => 1, candidate: () => 1 });
    const example = (pass: boolean) => ({
      name: pass ? "good" : "bad",
      case: s.cases[0] as (typeof s.cases)[number],
      trial: { ...(s.trials[0] as Trial), output: pass ? "yes" : "no" },
      expected: { type: "binary" as const, pass },
    });
    const computed: MeasureDefinition<"app/correct"> = {
      card: { ...card("app/correct").card, id: "app/correct", computedBy: "ichnaea" },
      score: (t) => ({ type: "binary", pass: t.output === "yes" }),
      examples: { good: [example(true)], bad: [example(false)] },
    };
    const { go } = await setup((trials, values) => ({ trials, values }), { measures: [computed] });
    await expect(go()).rejects.toThrow(
      "measure 'app/correct' is computed by Ichnaea; do not import its values",
    );
  });

  it("runs a gate's check itself, and refuses an imported result for it or an inconsistent one", async () => {
    const check: GateDefinition<"app/answers"> = {
      id: "app/answers",
      version: "1.0.0",
      description: "d",
      check: ({ trials }) => ({
        gate: "app/answers",
        passed: trials.length > 0,
        failures: trials.length > 0 ? 0 : 1,
      }),
    };
    const ok = await setup((trials, values) => ({ trials, values }), {
      gates: [check],
      hardGates: ["app/answers"],
    });
    await ok.go();
    expect((await new FileStore(ok.store).read("run-1")).gates).toEqual([
      { gate: "app/answers", passed: true, failures: 0 },
    ]);
    const imported = await setup(
      (trials, values) => ({
        trials,
        values,
        gates: [{ gate: "app/answers", passed: true, failures: 0 } as GateResult],
      }),
      { gates: [check], hardGates: ["app/answers"] },
    );
    await expect(imported.go()).rejects.toThrow("gate 'app/answers' is computed by its check");
    const lying = await setup(
      (trials, values) => ({
        trials,
        values,
        gates: [{ gate: "app/manual", passed: true, failures: 2 } as GateResult],
      }),
      { hardGates: ["app/manual"] },
    );
    await expect(lying.go()).rejects.toThrow("gate 'app/manual': passed is true with 2 failure(s)");
    const foreign = await setup((trials, values) => ({
      trials,
      values,
      gates: [{ gate: "app/else", passed: true, failures: 0 } as GateResult],
    }));
    await expect(foreign.go()).rejects.toThrow(
      "gate result for 'app/else', which the plan does not use",
    );
  });

  it("refuses to import the same run twice", async () => {
    const { go } = await setup((trials, values) => ({ trials, values }));
    await go();
    await expect(go()).rejects.toThrow("run 'run-1' already exists");
  });
});
