import { describe, expect, it } from "vitest";

import {
  binary,
  ImportError,
  importResults,
  NOT_CAPTURED,
  ScoreError,
  type TimedResult,
} from "../../src/core/index.ts";
import { digest, Outcome, Trial } from "../../src/contracts/index.ts";
import { suiteRecords } from "../../src/core/suite.ts";
import { createPlan } from "../../src/decide/index.ts";
import { answer, COMMIT, configuration, SUITE } from "./support/library.ts";

const base = configuration("base prompt", 0.2);
const candidate = configuration("candidate prompt", 0.2);
const plan = createPlan(SUITE, {
  run: "run-1",
  seed: 1,
  base,
  candidate,
  intendedChanges: ["/prompts/composer"],
  createdAt: "2026-11-16T12:00:00Z",
});
const OK = { text: "answer", declined: true };
const ROUTE = `sha256:${"c".repeat(64)}`;

/** One completed, timed result for every planned trial, each answering and declining. */
const results = (): TimedResult[] =>
  plan.record.trials.map((t) => ({
    result: answer(t, OK),
    startedAt: "2026-11-16T12:01:00Z",
    endedAt: "2026-11-16T12:02:00Z",
  }));

const replace = (index: number, row: TimedResult): TimedResult[] =>
  results().map((r, i) => (i === index ? row : r));
const first = plan.record.trials[0]!;
/** The first planned trial, c1 under the base arm, and c1 under the candidate arm. */
const FIRST = first.id;
const SECOND = plan.record.trials[1]!.id;

/** A result's observed configuration on the synthetic model, with this commit and route. */
const observed = (commit: string, route: string) => ({
  observed: { code: { commit }, model: "example-model", route, parameters: {} },
});

/** The suite and case set digests that a suite definition resolves to. */
const digestOf = (suite: typeof SUITE) => {
  const records = suiteRecords(suite);
  return { suite: digest(records.suite), caseSet: records.caseSet.digest };
};

/** Attempt `n` at the first trial, with `change` applied. */
const attempt = (n: number, change: Record<string, unknown> = {}, output: unknown = OK) =>
  answer(first, output, { ...change, trial: { ...answer(first, OK).trial, attempt: n } });

/** Earlier attempts, then one completed result for every planned trial. */
const withAttempts = (...earlier: TimedResult[]): TimedResult[] => [...earlier, ...results()];

describe("importResults", () => {
  it("scores each completed result from its raw output, with every measure the plan uses", () => {
    const { records, summary } = importResults(plan, results());
    expect(records.plan).toBe(plan.record);
    expect(records.trials).toHaveLength(24);
    expect(records.trials[0]).toMatchObject({
      id: FIRST,
      run: "run-1",
      outcome: "completed",
      configuration: plan.record.arms[0]?.identity,
      usage: { calls: 1 },
      startedAt: "2026-11-16T12:01:00Z",
    });
    // answered: 24 values; declines: 12 applicable and 12 not applicable.
    const answered = records.values.filter((v) => v.measure === "composer/answered");
    const declines = records.values.filter((v) => v.measure === "composer/declines");
    expect(answered.every((v) => v.applicable && v.value?.type === "binary" && v.value.pass)).toBe(
      true,
    );
    expect(declines.filter((v) => v.applicable)).toHaveLength(12);
    expect(records.run.ledger.every((e) => e.state === "recorded")).toBe(true);
    expect(records.run.startedAt).toBe("2026-11-16T12:01:00Z");
    expect(records.run.completedAt).toBe("2026-11-16T12:02:00Z");
    expect(summary).toEqual({
      rows: 24,
      trials: 24,
      values: 48,
      outcomes: { completed: 24 },
      notRun: 0,
      warnings: [],
      unused: [],
      earlierAttempts: [],
    });
  });

  it("stores the scorer's why beside its value, and a value without one has none", () => {
    const silent = replace(0, { result: answer(first, { text: "", declined: true }) });
    const { records } = importResults(plan, silent);
    const value = (trial: string, measure: string) =>
      records.values.find((v) => v.trial === trial && v.measure === measure);
    expect(value(FIRST, "composer/answered")).toMatchObject({
      value: { type: "binary", pass: false },
      why: "the answer is empty",
    });
    expect(value(SECOND, "composer/answered")).not.toHaveProperty("why");
  });

  it.each([
    ["an empty why", { value: false, why: " " }, "why is empty"],
    ["a why over two lines", { value: false, why: "one\ntwo" }, "why spans more than one line"],
    ["a why over 200 characters", { value: false, why: "x".repeat(201) }, "201 characters"],
    ["a bare boolean", true, "not { value, why? }"],
    ["a value that is not a boolean", { value: 1 }, "not true, false or undefined"],
  ])("refuses a scorer that gives %s, naming the measure and the trial", (_n, score, message) => {
    const odd = {
      ...SUITE,
      measures: { ...SUITE.measures, declines: binary({ score: () => score as never }) },
    };
    const p = createPlan(
      { ...odd, policy: { ...odd.policy, primary: { answered: SUITE.policy.primary.answered } } },
      {
        run: "run-why",
        createdAt: "2026-11-16T12:00:00Z",
        seed: 1,
        base,
        candidate,
        intendedChanges: ["/prompts/composer"],
      },
    );
    const run = () =>
      importResults(
        p,
        p.record.trials.map((t) => ({ result: answer(t, OK) })),
      );
    expect(run).toThrow(ScoreError);
    expect(run).toThrow(`measure 'composer/declines' on trial '${FIRST}': `);
    expect(run).toThrow(message);
  });

  it("takes results without times, and keeps the usage the worker reports", () => {
    const untimed = plan.record.trials.map((t) => ({
      result: answer(t, OK, { usage: { inputTokens: 10 } }),
    }));
    const { records } = importResults(plan, untimed);
    expect(records.trials[0]?.startedAt).toBeUndefined();
    expect(records.trials[0]?.usage).toEqual({ inputTokens: 10, calls: 1 });
    expect(records.run.startedAt).toBe(plan.record.createdAt);
  });

  it.each([
    ["infrastructure", "infrastructure_failure"],
    ["system", "system_failure"],
    ["not_run", "not_run"],
  ])("records a %s failure as %s, with its kind and message", (cls, outcome) => {
    const failed = answer(first, undefined, {
      failure: { class: cls, kind: "timeout", message: "no answer in 60 s" },
    });
    const { records } = importResults(plan, replace(0, { result: failed }));
    expect(records.trials[0]).toMatchObject({
      outcome,
      error: { kind: "timeout", message: "no answer in 60 s" },
    });
  });

  it("never gives a system failure a passing value, whatever its output", () => {
    const failed = answer(first, OK, { failure: { class: "system", kind: "crash" } });
    const { records } = importResults(plan, replace(0, { result: failed }));
    const value = records.values.find(
      (v) => v.trial === FIRST && v.measure === "composer/answered",
    );
    expect(value?.value).toEqual({ type: "binary", pass: false });
  });

  it("records a completed result with neither output nor pointer as not captured, and warns", () => {
    const { records, summary } = importResults(
      plan,
      replace(0, { result: answer(first, undefined) }),
    );
    expect(records.trials[0]).toMatchObject({
      outcome: "infrastructure_failure",
      error: { kind: NOT_CAPTURED },
    });
    expect(records.values.filter((v) => v.trial === FIRST && v.applicable)).toEqual([]);
    expect(summary.warnings).toEqual([
      `1 completed result(s) had no captured output, for example '${FIRST}'; they count as missing trials, never as failures of the system`,
    ]);
  });

  it("records a result with only a pointer as not captured, never scored, and warns", () => {
    const pointed = answer(first, undefined, { pointer: "trace-1" });
    const { records, summary } = importResults(plan, replace(0, { result: pointed }));
    expect(records.trials[0]).toMatchObject({
      outcome: "infrastructure_failure",
      pointer: "trace-1",
      error: { kind: NOT_CAPTURED },
    });
    expect(records.values.filter((v) => v.trial === FIRST && v.applicable)).toEqual([]);
    expect(summary.warnings).toEqual([
      `1 completed result(s) carry only a pointer to their output, for example '${FIRST}'; resolve pointers to outputs before import, because a pointer is never scored, so they count as missing trials`,
    ]);
  });

  it.each([
    [
      "a model the arm does not use",
      { observed: { code: { commit: COMMIT }, model: "other", route: ROUTE, parameters: {} } },
      "the worker called model 'other', not the arm's 'example-model'",
    ],
    [
      "another temperature",
      { temperature: 0.9 },
      "the worker used parameter 'temperature' = 0.9, not the arm's 0.2",
    ],
    [
      "a parameter the arm does not hold",
      {
        observed: {
          code: { commit: COMMIT },
          model: "example-model",
          route: ROUTE,
          parameters: { topP: 1 },
        },
      },
      "the worker used parameter 'topP', which the arm's configuration does not hold",
    ],
  ])(
    "refuses a result that observed %s, with the reason, and scores nothing",
    (_n, change, reason) => {
      const { records, summary } = importResults(
        plan,
        replace(0, { result: answer(first, OK, change) }),
      );
      expect(records.trials[0]).toMatchObject({
        outcome: "invalid_configuration",
        error: { kind: "configuration-mismatch", message: reason },
      });
      expect(records.values.some((v) => v.trial === FIRST)).toBe(false);
      expect(summary.warnings[0]).toContain(reason);
    },
  );

  it("checks the code and the route when the arm's configuration pins them", () => {
    const pinned = {
      ...base,
      models: base.models.map((m) => ({
        ...m,
        route: { value: "example-route", status: "pinned" as const },
      })),
      factors: {
        "code.commit": { value: "f".repeat(40), status: "pinned" as const, part: "code" as const },
      },
    };
    const p = createPlan(SUITE, {
      run: "run-2",
      seed: 1,
      base: pinned,
      candidate: pinned,
      createdAt: "2026-11-16T12:00:00Z",
    });
    const t = p.record.trials[0]!;
    const route = answer(t, OK).observed.route;
    const outcomeOf = (change: Record<string, unknown>) =>
      importResults(p, [{ result: answer(t, OK, change) }]).records.trials[0];
    expect(outcomeOf(observed("f".repeat(40), route))?.outcome).toBe("completed");
    expect(outcomeOf(observed(COMMIT, route))?.error?.message).toBe(
      `the worker ran commit ${COMMIT}, not the arm's "${"f".repeat(40)}"`,
    );
    expect(outcomeOf(observed("f".repeat(40), ROUTE))?.error?.message).toMatch(
      /which is not the arm's/,
    );
  });

  it("records a protocol failure as its own outcome, once per trial, and warns", () => {
    const bad = answer(first, undefined, { failure: { class: "protocol", kind: "bad-request" } });
    const { records, summary } = importResults(plan, replace(0, { result: bad }));
    expect(records.trials[0]).toMatchObject({
      id: FIRST,
      outcome: "protocol_failure",
      error: { kind: "bad-request" },
    });
    expect(records.run.ledger[0]).toEqual({
      trial: FIRST,
      state: "recorded",
      outcome: "protocol_failure",
    });
    expect(records.values.some((v) => v.trial === FIRST && v.applicable)).toBe(false);
    expect(summary.outcomes).toEqual({ completed: 23, protocol_failure: 1 });
    expect(summary.notRun).toBe(0);
    expect(summary.warnings).toEqual([
      `1 result(s) reported a protocol failure, for example '${FIRST}' (bad-request); the harness failed, so the run is INVALID`,
    ]);
  });

  it("fails closed: a reader of the earlier outcomes refuses a protocol failure", () => {
    const bad = answer(first, undefined, { failure: { class: "protocol", kind: "bad-request" } });
    const [trial] = importResults(plan, replace(0, { result: bad })).records.trials;
    const earlier = Trial.extend({ outcome: Outcome.exclude(["protocol_failure"]) });
    expect(earlier.safeParse(trial).success).toBe(false);
    expect(Trial.safeParse(trial).success).toBe(true);
  });

  it("refuses a failure class this version does not know", () => {
    const later = { ...answer(first, undefined), failure: { class: "quota", kind: "q" } };
    expect(() => importResults(plan, replace(0, { result: later as never }))).toThrow(
      /result\.failure\.class is "quota", which this version does not know/,
    );
  });

  it("ignores members no record defines, and reports them as unused", () => {
    const extra = { ...answer(first, OK), startedAt: "2026-11-16T12:00:00Z", score: 1 };
    const row = { result: extra, note: "x" } as unknown as TimedResult;
    const { records, summary } = importResults(plan, replace(0, row));
    expect(records.trials[0]?.outcome).toBe("completed");
    expect(records.trials[0]?.startedAt).toBeUndefined();
    expect(summary.unused).toEqual(["note", "result.score", "result.startedAt"]);
  });

  describe("retries", () => {
    const infra = { failure: { class: "infrastructure", kind: "timeout" } };

    it("counts the highest attempt, in any order, and keeps the earlier ones in the summary", () => {
      const { records, summary } = importResults(
        plan,
        withAttempts(
          { result: attempt(1, infra, undefined) },
          {
            result: attempt(2, { failure: { class: "not_run", kind: "never-reached" } }, undefined),
          },
        ).map((r, i) => (i === 2 ? { result: attempt(3) } : r)),
      );
      expect(records.trials.find((t) => t.id === FIRST)?.outcome).toBe("completed");
      expect(records.trials).toHaveLength(24);
      const earlier = [
        { attempt: 1, failure: { class: "infrastructure", kind: "timeout" }, calls: 1 },
        { attempt: 2, failure: { class: "not_run", kind: "never-reached" }, calls: 1 },
      ];
      expect(summary.earlierAttempts).toEqual(earlier.map((e) => ({ trial: FIRST, ...e })));
      expect(records.trials.find((t) => t.id === FIRST)?.attempts).toEqual(earlier);
    });

    it("makes a trial over budget when any attempt, an earlier one too, was over the call bound", () => {
      const rows = withAttempts({ result: attempt(1, { ...infra, calls: 5 }, undefined) }).map(
        (r, i) => (i === 1 ? { result: attempt(2) } : r),
      );
      const { records } = importResults(plan, rows);
      expect(records.trials.find((t) => t.id === FIRST)).toMatchObject({
        outcome: "budget_exceeded",
        error: {
          kind: "over-call-bound",
          message: "attempt 1 made 5 calls, over the bound of 1 per trial",
        },
        attempts: [{ attempt: 1, failure: { class: "infrastructure", kind: "timeout" }, calls: 5 }],
      });
    });

    it.each([
      ["a gap", [1, 3], "has attempts 1, 3"],
      ["a lone later attempt", [5], "has attempts 5"],
    ])("refuses %s in the attempt numbers", (_n, numbers, has) => {
      const rows = [
        ...numbers.map((n, i) =>
          i < numbers.length - 1
            ? { result: attempt(n, infra, undefined) }
            : { result: attempt(n) },
        ),
        ...results().slice(1),
      ];
      expect(() => importResults(plan, rows)).toThrow(
        `trial '${FIRST}' ${has}; the attempts of a trial are numbered 1 to k with no gap`,
      );
    });

    it("refuses a repeated attempt", () => {
      expect(() => importResults(plan, withAttempts({ result: attempt(1) }))).toThrow(
        `result 2: trial '${FIRST}' attempt 1 is repeated; give each attempt once`,
      );
    });

    it.each([
      ["a system failure", { failure: { class: "system", kind: "crash" } }, "a system failure"],
      [
        "a protocol failure",
        { failure: { class: "protocol", kind: "bad-request" } },
        "a protocol failure",
      ],
      ["a completed attempt", {}, "a completed attempt"],
    ])("refuses a retry after %s", (_n, change, what) => {
      const rows = withAttempts({ result: attempt(1, change, undefined) }).map((r, i) =>
        i === 1 ? { result: attempt(2) } : r,
      );
      expect(() => importResults(plan, rows)).toThrow(
        `trial '${FIRST}' attempt 2 follows ${what} at attempt 1; only an infrastructure failure or a trial not run is retried`,
      );
    });
  });

  it("records a trial over the per-trial call bound as over budget, with no passing value", () => {
    const over = answer(first, OK, { calls: SUITE.budget.callsPerTrial + 1 });
    const { records, summary } = importResults(plan, replace(0, { result: over }));
    expect(records.trials[0]).toMatchObject({
      outcome: "budget_exceeded",
      usage: { calls: 2 },
      error: {
        kind: "over-call-bound",
        message: "the trial made 2 calls, over the bound of 1 per trial",
      },
    });
    expect(
      records.values.filter((v) => v.trial === FIRST && v.applicable).map((v) => v.value),
    ).toEqual([{ type: "binary", pass: false }]);
    expect(summary.warnings).toContain(
      `1 result(s) made more calls than the bound of 1 per trial, for example '${FIRST}'; they count as over budget, so the run is INVALID`,
    );
  });

  it("records a planned trial without a result as not run", () => {
    const { records, summary } = importResults(plan, results().slice(1));
    expect(records.run.ledger[0]).toEqual({
      trial: FIRST,
      state: "planned",
      outcome: "not_run",
    });
    expect(summary.notRun).toBe(1);
  });

  it("refuses a result of a trial the plan does not list, of another suite, or repeated", () => {
    const stray = answer(
      { ...first, id: `nope/${first.arm}/r0` as never, case: "nope" as never },
      OK,
    );
    expect(() => importResults(plan, replace(0, { result: stray }))).toThrow(
      `result 1: trial 'nope/${first.arm}/r0' is not in the plan`,
    );
    const other = answer(first, OK, { trial: { ...answer(first, OK).trial, suite: "other" } });
    expect(() => importResults(plan, replace(0, { result: other }))).toThrow(
      "belongs to suite 'other', not 'composer'",
    );
    expect(() => importResults(plan, [...results(), results()[0]!])).toThrow(
      `result 25: trial '${FIRST}' attempt 1 is repeated; give each attempt once`,
    );
  });

  it("refuses a suite that is not the plan's: another limit, or another case", () => {
    const looser = {
      ...SUITE,
      policy: {
        ...SUITE.policy,
        primary: {
          ...SUITE.policy.primary,
          answered: { margin: 0.29, owner: "composer maintainer", reason: "Looser." },
        },
      },
    };
    expect(() => importResults({ ...plan, suite: looser }, results())).toThrow(
      `the suite's digest is ${digestOf(looser).suite}, but the plan was made from ${plan.record.suiteDigest}; import with the suite the plan was made from`,
    );
    const edited = {
      ...SUITE,
      cases: SUITE.cases.map((c, i) => (i === 0 ? { ...c, input: { question: "edited" } } : c)),
    };
    expect(() => importResults({ ...plan, suite: edited }, results())).toThrow(
      `the suite's case set digest is ${digestOf(edited).caseSet}, but the plan was made from ${plan.record.caseSetDigest}`,
    );
  });

  it("refuses a value that is not a trial result", () => {
    const empty = { result: {} } as unknown as TimedResult;
    expect(() => importResults(plan, [empty])).toThrow(ImportError);
    expect(() => importResults(plan, [empty])).toThrow(/result 1 is not a trial result/);
  });

  it("records the runtime it is given, and says so when it is not", () => {
    const runtime = { name: "node", version: "24.3.0", platform: "darwin", arch: "arm64" };
    expect(importResults(plan, results(), { runtime }).records.run.environment).toEqual({
      node: "24.3.0",
      platform: "darwin-arm64",
      ichnaea: plan.record.ichnaea,
      arch: "arm64",
      runtime,
    });
    expect(importResults(plan, results()).records.run.environment).toMatchObject({
      node: "unknown",
      platform: "unknown-unknown",
    });
    const deno = { name: "deno", version: "2.1.0", platform: "linux", arch: "x64" };
    expect(importResults(plan, results(), { runtime: deno }).records.run.environment).toMatchObject(
      { node: "2.1.0", runtime: deno },
    );
  });
});
