// REQ-06, REQ-19, REQ-20, REQ-21, REQ-28, REQ-33, REQ-49, REQ-80, REQ-86, REQ-114, REQ-126.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Case, Trial } from "@hephaestus-build/ichnaea-contracts";
import { describe, expect, it } from "vitest";

import {
  AppendOnlyError,
  CallLedger,
  createHost,
  decideEgress,
  definePlugin,
  FileStore,
  HostError,
  main,
  MonthlyCapError,
  type MeasureDefinition,
  type Plugin,
  satisfies,
  scoreTrials,
  testMeasure,
} from "../src/index.ts";

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
    const measure = { card: { id: "b/m" } } as unknown as MeasureDefinition<"a/m">;
    expect(() => createHost({ plugins: [stable("a", { measures: [measure] })] }, versions)).toThrow(
      "must be namespaced as 'a/…'",
    );
    const m = { card: { id: "a/m" } } as unknown as MeasureDefinition<"a/m">;
    expect(() => createHost({ plugins: [stable("a", { measures: [m, m] })] }, versions)).toThrow(
      "duplicate measure 'a/m'",
    );
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
    await host.planCreated({ power: [] } as never);
    expect(order).toEqual(["early", "middle", "late"]);
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

  it("lets any plugin refuse, and a governance plugin allow", async () => {
    const allow = stable("govern");
    const refuse = stable("strict");
    expect(
      (await decideEgress(request("pseudonymous"), [[allow, () => ({ allow: true })]], ctx)).allow,
    ).toBe(true);
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
  it("never overwrites a record and validates on write", async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "ichnaea-store-")));
    const plan = JSON.parse(
      await readFile(
        join(import.meta.dirname, "..", "..", "contracts", "fixtures", "valid", "plan.json"),
        "utf8",
      ),
    );
    await store.writePlan("r1", plan);
    await expect(store.writePlan("r1", plan)).rejects.toThrow(AppendOnlyError);
    await expect(store.writePlan("r2", { ...plan, arms: [] })).rejects.toThrow();
    await expect(store.read("r1")).rejects.toThrow("no plan or run record");
    expect(await store.runs()).toEqual(["r1"]);
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

describe("CLI (REQ-26, REQ-114)", () => {
  it("prints schemas and refuses unknown commands with a usage error", async () => {
    const out: string[] = [];
    expect(await main(["schema", "trial"], (t) => out.push(t))).toBe(0);
    expect(JSON.parse(out[0] as string).title).toBe("ichnaea.trial/1");
    expect(await main(["schema", "nothing"], () => undefined)).toBe(2);
    expect(await main([], () => undefined)).toBe(2);
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
  ])("%s satisfies %s: %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});

describe("planner (REQ-33)", () => {
  it("runs the tester of a measure with examples and refuses a failing one as primary", async () => {
    const { scenario } = await import("../../decide/test/support/scenario.ts");
    const s = await scenario({ cases: 4, replicates: 2, base: () => 1, candidate: () => 1 });
    const { createPlan } = await import("../src/index.ts");
    const broken = {
      ...exact,
      card: { ...exact.card, id: "app/correct" as const },
      score: () => ({ type: "binary" as const, pass: true }),
    };
    await expect(
      createPlan({
        suite: s.suite,
        caseSet: s.caseSet,
        cases: s.cases,
        arms: s.plan.arms.map((a) => ({
          name: a.name,
          role: a.role,
          configuration: a.configuration,
        })),
        measures: new Map([["app/correct", broken]]),
        trigger: "code",
        seed: 1,
        now: "2026-11-15T10:00:00Z",
        ichnaea: "0.0.0",
      }),
    ).rejects.toThrow("no passing known-good and known-bad test");
    const working = { ...exact, card: { ...exact.card, id: "app/correct" as const } };
    await expect(
      createPlan({
        suite: s.suite,
        caseSet: s.caseSet,
        cases: s.cases,
        arms: s.plan.arms.map((a) => ({
          name: a.name,
          role: a.role,
          configuration: a.configuration,
        })),
        measures: new Map([["app/correct", working]]),
        trigger: "code",
        seed: 1,
        now: "2026-11-15T10:00:00Z",
        ichnaea: "0.0.0",
      }),
    ).resolves.toMatchObject({ schema: "ichnaea.plan/1" });
  });
});
