// REQ-126: the library API moves no data across a boundary. With node:net, node:http, node:https,
// fetch and WebSocket replaced by traps that throw, the whole flow from defineSuite to report runs,
// and no trap is touched. A module that imported one of them would touch its trap on import.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { touched, trap } = vi.hoisted(() => {
  const used: string[] = [];
  const makeTrap = (name: string): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_, key) {
          used.push(`${name}.${String(key)}`);
          throw new Error(`${name} was used`);
        },
      },
    );
  return { touched: used, trap: makeTrap };
});
vi.mock("node:net", () => trap("node:net"));
vi.mock("node:http", () => trap("node:http"));
vi.mock("node:https", () => trap("node:https"));

import { importResults } from "../../src/core/results.ts";
import { binary, defineSuite } from "../../src/core/suite.ts";
import { compare } from "../../src/decide/compare.ts";
import { createPlan } from "../../src/decide/plan.ts";
import { report } from "../../src/report/report.ts";
import { answer, CASES, DEFINITION, configuration } from "../core/support/library.ts";

const refuse = (name: string) => (): never => {
  touched.push(name);
  throw new Error(`${name} was used`);
};

beforeAll(() => {
  vi.stubGlobal("fetch", refuse("fetch"));
  vi.stubGlobal("WebSocket", refuse("WebSocket"));
});
afterAll(() => vi.unstubAllGlobals());

describe("the library API", () => {
  it("runs from defineSuite to report with no network access", () => {
    const suite = defineSuite({
      ...DEFINITION,
      cases: CASES,
      measures: { ...DEFINITION.measures, answered: binary(DEFINITION.measures.answered) },
    });
    const base = configuration("base", 0.2);
    const plan = createPlan(suite, {
      run: "offline-1",
      seed: 1,
      base,
      candidate: configuration("candidate", 0.2),
      intendedChanges: ["/prompts/composer"],
      createdAt: "2026-11-16T12:00:00Z",
    });
    const rows = plan.record.trials.map((t) => ({
      result: answer(t, { text: "answer", declined: true }),
    }));
    const { records } = importResults(plan, rows);
    const decision = compare(plan, records, { decidedAt: "2026-11-16T13:00:00Z" });
    for (const format of ["markdown", "html", "json"] as const)
      expect(report(decision, { format })).not.toBe("");
    expect(decision.verdict).not.toBe("INVALID");
    expect(touched).toEqual([]);
  });

  it("would notice a use: the traps throw", async () => {
    expect(() => fetch("https://example.org")).toThrow("fetch was used");
    await expect(import("node:http").then((m) => m.request)).rejects.toThrow(/node:http/);
    touched.length = 0;
  });
});
