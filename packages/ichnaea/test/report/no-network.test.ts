// REQ-126: the pure core moves no data across a boundary. With node:net, node:http, node:https,
// node:http2, node:dns, node:tls, node:dgram, fetch, XMLHttpRequest and WebSocket replaced by traps
// that throw, a plan's records go through compare and report, and no trap is touched. A module that
// imported one of them would touch its trap on import.
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
vi.mock("node:http2", () => trap("node:http2"));
vi.mock("node:dns", () => trap("node:dns"));
vi.mock("node:tls", () => trap("node:tls"));
vi.mock("node:dgram", () => trap("node:dgram"));

import { compare } from "../../src/decide/compare.ts";
import { report } from "../../src/report/report.ts";
import { scenario } from "../decide/support/scenario.ts";

const refuse = (name: string) => (): never => {
  touched.push(name);
  throw new Error(`${name} was used`);
};

beforeAll(() => {
  vi.stubGlobal("fetch", refuse("fetch"));
  vi.stubGlobal("WebSocket", refuse("WebSocket"));
  vi.stubGlobal("XMLHttpRequest", refuse("XMLHttpRequest"));
});
afterAll(() => vi.unstubAllGlobals());

describe("the pure core", () => {
  it("plans, decides and reports with no network access", async () => {
    const s = await scenario({
      cases: 20,
      replicates: 2,
      base: () => 0.9,
      candidate: () => 0.9,
      opaque: true,
    });
    const decision = compare(s.plan, s, { decidedAt: "2026-11-16T13:00:00Z" });
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
