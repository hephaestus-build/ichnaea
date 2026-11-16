// REQ-06, REQ-19, REQ-20, REQ-21, REQ-28, REQ-33, REQ-49, REQ-80, REQ-86, REQ-114, REQ-126.
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Case,
  type Decision,
  type GateResult,
  Plan as PlanSchema,
  type Plan,
  type Run,
  type Trial,
} from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import {
  AppendOnlyError,
  CallLedger,
  CORE_VERSION,
  createHost,
  decideEgress,
  definePlugin,
  FileStore,
  HostError,
  main,
  MonthlyCapError,
  type MeasureDefinition,
  type Plugin,
  type PlanInput,
  type RunRecords,
  satisfies,
  scoreTrials,
  STALE_LOCK_MS,
  StoreError,
  testMeasure,
  TRIGGER_VARIES,
} from "../../src/core/index.ts";

const fixture = async (name: string): Promise<unknown> =>
  JSON.parse(
    await readFile(
      join(import.meta.dirname, "..", "..", "fixtures", "valid", `${name}.json`),
      "utf8",
    ),
  );
const plan: Plan = PlanSchema.parse(await fixture("plan"));
const runFixture = (await fixture("run")) as Run;
const trialFixture = (await fixture("trial")) as Trial;
const records = (id: string): RunRecords => ({
  plan,
  run: { ...runFixture, id: id as Run["id"] },
  trials: [trialFixture],
  values: [],
  gates: [],
});

const versions = { core: "0.3.1", contracts: "1.2.0" };
const stable = (id: string, extra: Partial<Plugin> = {}): Plugin => ({
  id,
  version: "1.0.0",
  stability: "stable",
  ...extra,
});

describe("plugin host (REQ-80)", () => {
  it("fails at load time on duplicate plugins, un-namespaced parts and duplicate measures, naming the plugin", () => {
    expect(() => createHost({ plugins: [stable("a"), stable("a")] }, versions)).toThrow(
      "plugin 'a' is listed twice",
    );
    const measure = {
      ...exact,
      card: { ...exact.card, id: "b/m" },
    } as unknown as MeasureDefinition<"a/m">;
    expect(() => createHost({ plugins: [stable("a", { measures: [measure] })] }, versions)).toThrow(
      "must be namespaced as 'a/…'",
    );
    const m = { ...exact, card: { ...exact.card, id: "a/m" } } as MeasureDefinition<"a/m">;
    expect(() => createHost({ plugins: [stable("a", { measures: [m, m] })] }, versions)).toThrow(
      "duplicate measure 'a/m'",
    );
  });

  it("validates measure cards when a plugin loads (REQ-29)", () => {
    const noCard = {} as unknown as MeasureDefinition<"a/m">;
    expect(() => createHost({ plugins: [stable("a", { measures: [noCard] })] }, versions)).toThrow(
      "plugin 'a': a measure has no card",
    );
    const bad = {
      ...exact,
      card: { ...exact.card, id: "a/m", valueType: "fuzzy" },
    } as unknown as MeasureDefinition<"a/m">;
    expect(() => createHost({ plugins: [stable("a", { measures: [bad] })] }, versions)).toThrow(
      /the card of measure 'a\/m' is invalid: valueType/,
    );
  });

  it("refuses a plugin command that would replace a core command", () => {
    for (const name of ["import", "doctor", "schema", "help"]) {
      const command = { name, description: "d", options: {}, run: async () => 0 };
      expect(() =>
        createHost({ plugins: [stable("a", { commands: [command] })] }, versions),
      ).toThrow(`command '${name}' is a core command`);
    }
  });

  it("requires a named opt-in for plugins below stable", () => {
    expect(() => createHost({ plugins: [stable("a", { stability: "beta" })] }, versions)).toThrow(
      HostError,
    );
    expect(() =>
      createHost(
        { plugins: [stable("a", { stability: "beta" })], allowStability: ["beta"] },
        versions,
      ),
    ).not.toThrow();
  });

  it("refuses a plugin outside its peer range and warns on deprecation with the replacement", () => {
    expect(() =>
      createHost({ plugins: [stable("a", { requires: { core: "^0.4.0" } })] }, versions),
    ).toThrow("requires core ^0.4.0, but 0.3.1 is loaded");
    const host = createHost(
      {
        plugins: [
          stable("a", {
            deprecated: {
              since: "1.1.0",
              removeIn: "2.0.0",
              replacement: "b",
              url: "https://example.org",
            },
          }),
        ],
      },
      versions,
    );
    expect(host.warnings[0]).toMatch(/use b/);
  });

  it("runs sequential hooks in plugin order with pre and post placement", async () => {
    const order: string[] = [];
    const plugin = (id: string, placement?: "pre" | "post"): Plugin =>
      stable(id, {
        ...(placement ? { placement } : {}),
        hooks: { planCreated: () => void order.push(id) },
      });
    const host = createHost(
      { plugins: [plugin("late", "post"), plugin("middle"), plugin("early", "pre")] },
      versions,
    );
    await host.planCreated(plan);
    expect(order).toEqual(["early", "middle", "late"]);
  });

  it("fires every lifecycle hook, and no hook turns an estimate-only plan into a decision", async () => {
    const seen: string[] = [];
    const host = createHost(
      {
        plugins: [
          stable("watch", {
            hooks: {
              configResolved: () => void seen.push("configResolved"),
              trialRecorded: () => void seen.push("trialRecorded"),
              runCompleted: () => void seen.push("runCompleted"),
              decisionMade: () => void seen.push("decisionMade"),
              reportRendered: () => void seen.push("reportRendered"),
            },
          }),
        ],
      },
      versions,
    );
    await host.configResolved();
    await host.trialRecorded(trialWith("completed"));
    await host.runCompleted({} as Run);
    await host.decisionMade({} as Decision);
    await host.reportRendered([]);
    expect(seen).toEqual([
      "configResolved",
      "trialRecorded",
      "runCompleted",
      "decisionMade",
      "reportRendered",
    ]);
    const upgrade = createHost(
      {
        plugins: [
          stable("sneaky", { hooks: { planCreated: () => ({ mode: "decision" }) as never } }),
        ],
      },
      versions,
    );
    await expect(upgrade.planCreated({ ...plan, mode: "estimate-only" })).rejects.toThrow(
      "cannot turn an estimate-only plan into a decision",
    );
    const downgrade = createHost(
      {
        plugins: [
          stable("careful", {
            hooks: { planCreated: () => ({ mode: "estimate-only", modeReasons: ["why"] }) },
          }),
        ],
      },
      versions,
    );
    expect(await downgrade.planCreated(plan)).toMatchObject({
      mode: "estimate-only",
      modeReasons: ["why"],
    });
  });

  it("lets a planCreated hook refuse a plan", async () => {
    const host = createHost(
      {
        plugins: [
          stable("gatekeeper", { hooks: { planCreated: () => ({ refuse: "underpowered" }) } }),
        ],
      },
      versions,
    );
    await expect(host.planCreated({} as never)).rejects.toThrow("refused the plan: underpowered");
  });

  it("infers literal plugin and measure IDs", () => {
    const p = definePlugin({ id: "app", version: "1.0.0", stability: "stable" });
    const id: "app" = p.id;
    expect(id).toBe("app");
  });
});

const request = (dataClass: "none" | "pseudonymous" | "personal") => ({
  operation: "export" as const,
  purpose: "PU-1" as const,
  dataClass,
  destination: "file",
  pointers: [],
});

describe("egress (REQ-126)", () => {
  const ctx = { log: () => undefined };

  it("denies every class but none by default", async () => {
    expect((await decideEgress(request("none"), [], ctx)).allow).toBe(true);
    expect((await decideEgress(request("pseudonymous"), [], ctx)).allow).toBe(false);
    expect((await decideEgress(request("personal"), [], ctx)).reasons[0]).toMatch(/default deny/);
  });

  it("lets any plugin refuse, and only the governance plugin the configuration names allow", async () => {
    const notGovernance = stable("helpful");
    const logged: string[] = [];
    expect(
      (
        await decideEgress(request("personal"), [[notGovernance, () => ({ allow: true })]], {
          log: (m) => logged.push(m),
        })
      ).allow,
    ).toBe(false);
    expect(logged[0]).toMatch(/'helpful' is not a governance plugin/);
    const allow = stable("govern");
    const refuse = stable("strict");
    const allowing: Array<[Plugin, () => { allow: true }]> = [[allow, () => ({ allow: true })]];
    expect((await decideEgress(request("pseudonymous"), allowing, ctx, "govern")).allow).toBe(true);
    // The same plugin, not named by the configuration, cannot open egress.
    expect((await decideEgress(request("pseudonymous"), allowing, ctx)).allow).toBe(false);
    expect((await decideEgress(request("pseudonymous"), allowing, ctx, "other")).allow).toBe(false);
    expect(() => createHost({ plugins: [allow], governance: "missing" }, versions)).toThrow(
      "governance names plugin 'missing', which the configuration does not list",
    );
    expect(
      (
        await decideEgress(
          request("none"),
          [[refuse, () => ({ allow: false, reason: "no purpose record" })]],
          ctx,
        )
      ).reasons[0],
    ).toBe("strict: no purpose record");
  });
});

describe("file store (REQ-28) and call ledger (REQ-86)", () => {
  it("writes a run once and atomically, validates it, and never overwrites it", async () => {
    const root = await mkdtemp(join(tmpdir(), "ichnaea-store-"));
    const store = new FileStore(root);
    await store.createRun(records("r1"));
    await expect(store.createRun(records("r1"))).rejects.toThrow(AppendOnlyError);
    await expect(
      store.createRun({ ...records("r2"), plan: { ...plan, arms: [] } }),
    ).rejects.toThrow();
    expect(await store.runs()).toEqual(["r1"]);
    expect((await readdir(join(root, "runs"))).filter((n) => n.startsWith(".incomplete"))).toEqual(
      [],
    );
    const stored = await store.read("r1");
    expect(stored.trials).toHaveLength(1);
    await expect(store.read("r2")).rejects.toThrow("no plan or run record");
  });

  it("refuses duplicate trials, values and gate results, which would hide a regression", async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "ichnaea-store-")));
    const r = records("r1");
    const trial = r.trials[0] as Trial;
    await expect(store.createRun({ ...r, trials: [trial, trial] })).rejects.toThrow(
      `duplicate trial ID(s): ${trial.id}`,
    );
    const gate = { gate: "app/g", passed: true, failures: 0 } as GateResult;
    await expect(store.createRun({ ...r, gates: [gate, gate] })).rejects.toThrow(
      "duplicate gate result(s): app/g",
    );
  });

  it("stores every contract-valid run ID inside its root, and names a broken line", async () => {
    const root = await mkdtemp(join(tmpdir(), "ichnaea-store-"));
    const store = new FileStore(root);
    await store.createRun(records("pr:42/1"));
    expect(await store.runs()).toEqual(["pr:42/1"]);
    expect(await readdir(join(root, "runs"))).toEqual(["pr%3A42%2F1"]);
    for (const id of [".", ".."]) await expect(store.read(id)).rejects.toThrow(StoreError);
    await appendFile(join(root, "runs", "pr%3A42%2F1", "trials.jsonl"), '{"schema": "ichnaea.tri');
    await expect(store.read("pr:42/1")).rejects.toThrow(/^pr:42\/1\/trials\.jsonl:2: not JSON/);
    await writeFile(join(root, "index.jsonl"), '{"run":"x"}\n');
    await expect(store.index()).rejects.toThrow(/index\.jsonl:1: invalid record/);
  });

  it("refuses a run that would exceed the monthly cap, before any call", async () => {
    const ledger = new CallLedger(await mkdtemp(join(tmpdir(), "ichnaea-ledger-")));
    await ledger.reserve("endpoint", 100, { run: "a", calls: 90, at: "2026-11-15T00:00:00Z" });
    await expect(
      ledger.reserve("endpoint", 100, { run: "b", calls: 20, at: "2026-11-20T00:00:00Z" }),
    ).rejects.toThrow(MonthlyCapError);
    expect(await ledger.used("endpoint", "2026-11-30T00:00:00Z")).toBe(90);
    expect(await ledger.used("endpoint", "2026-12-01T00:00:00Z")).toBe(0);
  });

  it("takes over a lock that a crashed run left behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "ichnaea-ledger-"));
    const ledger = new CallLedger(root);
    const lock = join(root, "ledger", "endpoint", "2026-11.jsonl.lock");
    await mkdir(join(lock, ".."), { recursive: true });
    await writeFile(lock, "");
    const old = new Date(Date.now() - STALE_LOCK_MS - 1000);
    await utimes(lock, old, old);
    await expect(
      ledger.reserve("endpoint", 100, { run: "a", calls: 1, at: "2026-11-15T00:00:00Z" }),
    ).resolves.toEqual({ used: 1, remaining: 99 });
  });

  it("reads a run with a missing records file as damaged, never as empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "ichnaea-store-"));
    const store = new FileStore(root);
    await store.createRun(records("r1"));
    await rm(join(root, "runs", "r1", "values.jsonl"));
    await expect(store.read("r1")).rejects.toThrow(/^run 'r1' has no values\.jsonl in /);
  });

  it("serialises concurrent reservations, so together they cannot exceed the cap", async () => {
    const ledger = new CallLedger(await mkdtemp(join(tmpdir(), "ichnaea-ledger-")));
    await ledger.reserve("endpoint", 100, { run: "a", calls: 90, at: "2026-11-15T00:00:00Z" });
    const results = await Promise.allSettled(
      ["b", "c", "d"].map((run) =>
        ledger.reserve("endpoint", 100, { run, calls: 10, at: "2026-11-15T00:00:00Z" }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ledger.used("endpoint", "2026-11-15T00:00:00Z")).toBe(100);
  });
});

const aCase = {
  schema: "ichnaea.case/1",
  id: "c1",
  unit: "turn",
  dataClass: "none",
  input: { q: "?" },
  provenance: {
    source: "authored",
    selection: "curated",
    created: "2026-01-01",
    licence: "CC0-1.0",
    exposure: "public",
  },
  pool: "development",
} as unknown as Case;
const trialWith = (outcome: Trial["outcome"], output: unknown = "yes"): Trial =>
  ({
    schema: "ichnaea.trial/1",
    id: `t-${outcome}`,
    source: "offline",
    case: "c1",
    unit: "turn",
    configuration: `sha256:${"a".repeat(64)}`,
    replicate: 0,
    outcome,
    dataClass: "none",
    output,
  }) as Trial;
const exact: MeasureDefinition = {
  card: {
    id: "app/exact",
    version: "1.0.0",
    construct: "c",
    operationalDefinition: "o",
    valueType: "binary",
    unit: "proportion",
    direction: "higher",
    justification: "j",
    errorModel: "e",
    applicability: "a",
    tier: "primary",
    unitOfEvaluation: "turn",
    establishes: "e",
    computedBy: "ichnaea",
  },
  score: (t) => ({ type: "binary", pass: t.output === "yes" }),
  examples: {
    good: [
      {
        name: "right",
        case: aCase,
        trial: trialWith("completed"),
        expected: { type: "binary", pass: true },
      },
    ],
    bad: [
      {
        name: "wrong",
        case: aCase,
        trial: trialWith("completed", "no"),
        expected: { type: "binary", pass: false },
      },
    ],
  },
};

describe("measures (REQ-20, REQ-30, REQ-33)", () => {
  it("scores every outcome class as the design states", () => {
    const cases = new Map([["c1", aCase]]);
    const scored = (outcome: Trial["outcome"]) =>
      scoreTrials([exact], [trialWith(outcome)], cases)[0];
    expect(scored("completed")?.value).toEqual({ type: "binary", pass: true });
    expect(scored("abstained")?.value).toEqual({ type: "binary", pass: true });
    expect(scored("system_failure")?.value).toEqual({ type: "binary", pass: false });
    expect(scored("budget_exceeded")?.value).toEqual({ type: "binary", pass: false });
    for (const missing of ["infrastructure_failure", "not_run", "invalid_configuration"] as const)
      expect(scored(missing)).toBeUndefined();
  });

  it("records not applicable explicitly, never as zero", () => {
    const narrow = { ...exact, appliesTo: () => false };
    expect(
      scoreTrials([narrow], [trialWith("completed")], new Map([["c1", aCase]]))[0],
    ).toMatchObject({ applicable: false });
  });

  it("fails the tester when a known-bad example passes, or when examples are missing", async () => {
    expect((await testMeasure(exact)).status).toBe("passed");
    const broken = { ...exact, score: () => ({ type: "binary" as const, pass: true }) };
    expect((await testMeasure(broken)).failures[0]).toMatch(/bad example 'wrong'/);
    expect((await testMeasure({ ...exact, examples: { good: [], bad: [] } })).status).toBe(
      "failed",
    );
  });
});

// Node before 22.18 fails to import a .ts file with this code.
const unknownExtension = (): Promise<never> =>
  Promise.reject(
    Object.assign(new TypeError('Unknown file extension ".ts"'), {
      code: "ERR_UNKNOWN_FILE_EXTENSION",
    }),
  );
const failing = (): Promise<never> => Promise.reject(new Error("boom"));

describe("CLI (REQ-26, REQ-114)", () => {
  it("prints schemas and refuses unknown commands with a usage error", async () => {
    const out: string[] = [];
    expect(await main(["schema", "trial"], (t) => out.push(t))).toBe(0);
    expect(JSON.parse(out[0] as string).title).toBe("ichnaea.trial/1");
    expect(await main(["schema", "nothing"], () => undefined)).toBe(2);
    expect(await main([], () => undefined)).toBe(2);
  });

  it("exits 2 on every error, so an error never reads as a policy block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-cli-"));
    const config = join(dir, "ichnaea.config.ts");
    await writeFile(config, "export default { plugins: [] };\n");
    const base = [
      "import",
      "--config",
      config,
      "--importer",
      "x",
      "--suite",
      "s",
      "--case-set",
      "c",
      "--cases",
      "c",
      "--run",
      "r",
      "--arm",
      "a:base:f",
    ];
    for (const extra of [
      ["--seed", "abc"],
      ["--trigger", "whenever"],
      ["--bogus"],
      ["--arm", "broken"],
    ]) {
      const out: string[] = [];
      expect(await main([...base, ...extra], (t) => out.push(t))).toBe(2);
      expect(out.join(" ")).not.toMatch(/ZodError/);
    }
    const out: string[] = [];
    expect(await main(["nothing", "--config", config], (t) => out.push(t))).toBe(2);
    expect(out[0]).toBe("unknown command 'nothing'. Commands: help, schema, doctor, import");
    expect(await main([...base], () => undefined)).toBe(2);
  });

  it("names the Node version a .ts configuration needs when Node cannot load it, and exits 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-cli-"));
    const ts = join(dir, "ichnaea.config.ts");
    const txt = join(dir, "ichnaea.config.txt");
    for (const file of [ts, txt]) await writeFile(file, "export default { plugins: [] };\n");
    const out: string[] = [];
    expect(await main(["doctor", "--config", ts], (t) => out.push(t), unknownExtension)).toBe(2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^configuration error: .*ichnaea\.config\.ts is TypeScript/);
    expect(out[0]).toContain("Ichnaea needs Node 24.3 or later");
    // Another failure of the loader, or the same code on a file that is not TypeScript, is not rewritten.
    out.length = 0;
    expect(await main(["doctor", "--config", ts], (t) => out.push(t), failing)).toBe(2);
    expect(out).toEqual(["configuration error: boom"]);
    out.length = 0;
    expect(await main(["doctor", "--config", txt], (t) => out.push(t), unknownExtension)).toBe(2);
    expect(out).toEqual(['configuration error: Unknown file extension ".ts"']);
  });

  it("lists every trigger and what its arms may differ in, from the rule decide applies", async () => {
    const out: string[] = [];
    expect(await main(["help"], (t) => out.push(t))).toBe(0);
    const lines = (out[0] as string).split("\n").map((l) => l.trim());
    expect(lines).toContain("Triggers (--trigger, default code) and what the arms may differ in:");
    for (const [trigger, parts] of Object.entries(TRIGGER_VARIES)) {
      const line = lines.find((l) => l.startsWith(`${trigger} `));
      expect(line, trigger).toBeDefined();
      if (parts === null) expect(line).toContain("nothing in the system");
      else for (const part of parts) expect(line).toContain(`the ${part} part`);
    }
    expect(lines.find((l) => l.startsWith("new-model "))).toMatch(/the model part/);
    expect(lines.find((l) => l.startsWith("configuration "))).toMatch(
      /^configuration\s+what --vary declares$/,
    );
    expect(out[0]).toContain("Exit codes: 0 success");
  });

  it("prints the version with --version and -v, with no configuration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-cli-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      for (const flag of ["--version", "-v"]) {
        const out: string[] = [];
        expect(await main([flag], (t) => out.push(t))).toBe(0);
        expect(out).toEqual([CORE_VERSION]);
      }
    } finally {
      process.chdir(cwd);
    }
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("says where the configuration is missing, for every command that needs it, and exits 2", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ichnaea-cli-")));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      for (const argv of [["doctor"], ["decide"], ["nothing"], ["import"]]) {
        const out: string[] = [];
        expect(await main(argv, (t) => out.push(t))).toBe(2);
        expect(out).toEqual([`no ichnaea.config.ts in ${dir}; see the README's quick start`]);
      }
      const out: string[] = [];
      expect(await main(["doctor", "--config", "other.config.ts"], (t) => out.push(t))).toBe(2);
      expect(out).toEqual([`no other.config.ts in ${dir}; see the README's quick start`]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("runs doctor with no plugins and reports a clean configuration (REQ-06)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-cli-"));
    const config = join(dir, "ichnaea.config.ts");
    await writeFile(config, "export default { plugins: [] };\n");
    const out: string[] = [];
    expect(await main(["doctor", "--config", config], (t) => out.push(t))).toBe(0);
    expect(out).toEqual(["plugins: none", "doctor: clean"]);
  });
});

describe("versions", () => {
  it.each([
    ["0.3.1", "^0.3.0", true],
    ["0.4.0", "^0.3.0", false],
    ["1.4.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["1.2.9", "~1.2.0", true],
    ["1.3.0", "~1.2.0", false],
    ["1.0.0-rc.1", ">=1.0.0", false],
    ["0.0.1", "^0.0.0", false],
    ["0.0.0", "^0.0.0", true],
    ["0.1.5", "^0.1.0", true],
    ["0.2.0", "^0.1.0", false],
  ])("%s satisfies %s: %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});

describe("planner (REQ-16, REQ-19, REQ-27, REQ-33, REQ-49, decision 0008)", async () => {
  const { scenario, card, configuration } = await import("../decide/support/scenario.ts");
  const { createPlan, PlanError } = await import("../../src/core/index.ts");
  const s = await scenario({ cases: 8, replicates: 2, base: () => 1, candidate: () => 1 });
  const arms: PlanInput["arms"] = s.plan.arms.map((a) => ({
    name: a.name,
    role: a.role,
    configuration: a.configuration,
  }));
  const input = {
    suite: s.suite,
    caseSet: s.caseSet,
    cases: s.cases,
    arms,
    measures: new Map([["app/correct", card("app/correct")]]),
    gates: new Map(),
    trigger: "code" as const,
    seed: 1,
    now: "2026-11-15T10:00:00Z",
    ichnaea: "0.0.0",
  };
  const planWith = (change: Partial<typeof input> = {}): Promise<Plan> =>
    createPlan({ ...input, ...change });

  const reasonsOf = async (change: Partial<typeof input>): Promise<string[]> => {
    const p = await planWith(change);
    expect(p.mode).toBe("estimate-only");
    return p.modeReasons;
  };

  it("lists every trial before any call, in alternating batches, with unique IDs", async () => {
    const p = await planWith();
    expect(p.mode).toBe("decision");
    expect(p.modeReasons).toEqual([]);
    expect(p.trials).toHaveLength(8 * 2 * 2);
    expect(p.trials[0]).toEqual({
      id: "case-000/base/r0",
      case: "case-000",
      arm: "base",
      replicate: 0,
      batch: 0,
    });
    expect(p.trials.at(-1)?.batch).toBe(3);
    expect(p.measures[0]).toMatchObject({ kind: "measure", id: "app/correct", version: "1.0.0" });
    expect(p.measures[0]?.digest).toMatch(/^sha256:/);
  });

  it("runs the tester of a measure Ichnaea computes, whatever its card says", async () => {
    const asserted = {
      ...exact,
      card: {
        ...exact.card,
        id: "app/correct" as const,
        validation: {
          tester: {
            status: "passed" as const,
            digest: `sha256:${"1".repeat(64)}`,
            ranAt: "2026-11-15T00:00:00Z",
          },
        },
      },
    };
    const broken = { ...asserted, score: () => ({ type: "binary" as const, pass: true }) };
    await expect(planWith({ measures: new Map([["app/correct", broken]]) })).rejects.toThrow(
      "no passing known-good and known-bad test",
    );
    const { examples: _e, ...untested } = asserted;
    await expect(planWith({ measures: new Map([["app/correct", untested]]) })).rejects.toThrow(
      PlanError,
    );
    await expect(
      planWith({ measures: new Map([["app/correct", asserted]]) }),
    ).resolves.toMatchObject({
      mode: "decision",
    });
  });

  it("refuses unknown measures and gates, and margins it cannot use", async () => {
    await expect(planWith({ measures: new Map() })).rejects.toThrow(
      "primary measure 'app/correct' is not provided",
    );
    await expect(
      planWith({ suite: { ...s.suite, secondary: ["app/nope"] as never } }),
    ).rejects.toThrow("secondary measure 'app/nope' is not provided");
    await expect(
      planWith({ suite: { ...s.suite, hardGates: ["app/gate"] as never } }),
    ).rejects.toThrow("hard gate 'app/gate' is not provided");
    for (const [margin, safetyMargin] of [
      [1, 0],
      [0.05, 0.1],
    ] as const) {
      const primary = s.suite.primary.map((m) => ({ ...m, margin, safetyMargin }));
      await expect(planWith({ suite: { ...s.suite, primary } })).rejects.toThrow(
        /the margin must be below 1/,
      );
    }
  });

  it("refuses arm names that could collide in trial IDs, duplicate arms, and a second candidate", async () => {
    await expect(planWith({ arms: [{ ...arms[0]!, name: "a/b" }, arms[1]!] })).rejects.toThrow(
      "arm name 'a/b'",
    );
    await expect(planWith({ arms: [arms[0]!, { ...arms[1]!, name: "base" }] })).rejects.toThrow(
      "arm names must be unique",
    );
    await expect(
      planWith({ arms: [...arms, { ...arms[1]!, name: "candidate2" }] }),
    ).rejects.toThrow("more than one candidate arm is not supported yet");
    await expect(planWith({ arms: [arms[0]!, { ...arms[1]!, role: "base" }] })).rejects.toThrow(
      "at most one base arm",
    );
  });

  it("selects cases by the case set's pool, and refuses a pool or family the case does not have", async () => {
    const sealedEntries = s.caseSet.cases.map((e) => ({ ...e, pool: "sealed" as const }));
    const { caseSetDigest } = await import("../../src/contracts/index.ts");
    const sealed = {
      ...s.caseSet,
      cases: sealedEntries,
      digest: await caseSetDigest(sealedEntries),
    };
    await expect(
      planWith({ caseSet: sealed, suite: { ...s.suite, pools: ["sealed"] } }),
    ).rejects.toThrow("is in pool 'development', but the case set lists it in 'sealed'");
    const resealed = s.cases.map((c) => ({ ...c, pool: "sealed" as const }));
    const { caseDigest } = await import("../../src/contracts/index.ts");
    const entries = await Promise.all(
      resealed.map(async (c) => ({ id: c.id, digest: await caseDigest(c), pool: c.pool })),
    );
    const set = { ...s.caseSet, cases: entries, digest: await caseSetDigest(entries) };
    await expect(
      planWith({ caseSet: set, cases: resealed, suite: { ...s.suite, pools: ["sealed"] } }),
    ).rejects.toThrow("a sealed pool runs only in a locked confirmatory plan");
    const familied = s.caseSet.cases.map((e) => ({ ...e, family: "f" }));
    const f = { ...s.caseSet, cases: familied, digest: await caseSetDigest(familied) };
    await expect(planWith({ caseSet: f })).rejects.toThrow(
      "has family 'none', but the case set lists 'f'",
    );
  });

  it("refuses sampled-cases on curated cases", async () => {
    await expect(planWith({ suite: { ...s.suite, estimand: "sampled-cases" } })).rejects.toThrow(
      "sampled-cases needs a randomly drawn pool",
    );
  });

  it("runs estimate-only, and says why, where no validated method can decide (decisions 0008, 0009)", async () => {
    expect(
      await reasonsOf({ measures: new Map([["app/correct", card("app/correct", "proportion")]]) }),
    ).toEqual([
      "primary measure 'app/correct' has proportion values, which no validated method decides yet (decision 0008)",
    ]);
    expect(await reasonsOf({ arms: [arms[0]!] })).toEqual([
      "the plan has no base and candidate arm to compare",
    ]);
    expect(await reasonsOf({ suite: { ...s.suite, primary: [] } })).toEqual([
      "the suite declares no primary measure",
    ]);
    // One trial per case and arm decides binary measures only (test/core/one-trial-plan.test.ts).
    expect(
      await reasonsOf({
        suite: { ...s.suite, replicates: 1 },
        measures: new Map([["app/correct", card("app/correct", "proportion")]]),
      }),
    ).toEqual([
      "primary measure 'app/correct' has proportion values, which no validated method decides yet (decision 0008)",
      "one trial per case and arm is outside the validated domain",
    ]);
    const few = await scenario({ cases: 4, replicates: 2, base: () => 1, candidate: () => 1 });
    expect(await reasonsOf({ suite: few.suite, caseSet: few.caseSet, cases: few.cases })).toEqual([
      "4 case(s); a decision is validated from 5 cases",
    ]);
    void configuration;
  });

  it("refuses a primary measure whose card is not of tier primary, or is a composite (REQ-34)", async () => {
    const secondary = card("app/correct");
    await expect(
      planWith({
        measures: new Map([
          ["app/correct", { ...secondary, card: { ...secondary.card, tier: "secondary" } }],
        ]),
      }),
    ).rejects.toThrow(
      "primary measure 'app/correct' has a secondary card; only a card of tier primary can decide",
    );
    await expect(
      planWith({
        measures: new Map([
          ["app/correct", { ...secondary, card: { ...secondary.card, composite: true } }],
        ]),
      }),
    ).rejects.toThrow(
      /is a composite of other measures; report it as a secondary measure \(REQ-34\)$/,
    );
  });

  it("runs a placeholder margin estimate-only: margins not registered", async () => {
    expect(
      await reasonsOf({
        suite: {
          ...s.suite,
          primary: s.suite.primary.map((p) => ({ ...p, marginStatus: "placeholder" as const })),
        },
      }),
    ).toEqual([
      "margins not registered: primary measure 'app/correct' has a placeholder margin (decision 0012)",
    ]);
  });

  it("records what a change declares as varied, sorted, and refuses what is not a factor key", async () => {
    const p = await createPlan({
      ...input,
      varies: ["prompt.answer", "model.answer", "prompt.answer"],
    });
    expect(p.varies).toEqual(["model.answer", "prompt.answer"]);
    await expect(createPlan({ ...input, varies: ["temperature"] })).rejects.toThrow(
      "'temperature' is not a factor key; use model.<role>, parameter.<name>, prompt.<name> or factor.<name>",
    );
    await expect(
      createPlan({ ...input, trigger: "judge", varies: ["model.answer"] }),
    ).rejects.toThrow(
      "a judge trigger changes nothing in the system, so it cannot declare model.answer as varied",
    );
    expect(PlanError).toBeDefined();
  });

  it("gives the cases of a replicatesFor slice their larger trial count, and refuses a slice that matches nothing", async () => {
    const sliced = await scenario({
      cases: 8,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      slices: (i) => (i < 3 ? { group: "small" } : undefined),
      replicatesFor: [
        { slice: "group", value: "small", replicates: 3, reason: "few cases" },
        { slice: "group", value: "small", replicates: 4, reason: "largest wins" },
      ],
    });
    const p = sliced.plan;
    const count = (c: string): number =>
      p.trials.filter((t) => t.case === c && t.arm === "base").length;
    expect([count("case-000"), count("case-003")]).toEqual([4, 2]);
    expect(
      p.trials.filter((t) => t.replicate === 3).every((t) => Number(t.case.slice(5)) < 3),
    ).toBe(true);
    await expect(
      planWith({
        suite: {
          ...s.suite,
          replicatesFor: [{ slice: "group", value: "nowhere", replicates: 3, reason: "r" }],
        },
      }),
    ).rejects.toThrow("replicatesFor group=nowhere matches no selected case");
  });
});
