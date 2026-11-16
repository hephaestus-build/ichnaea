// REQ-22, REQ-25: the worker protocol's records. A request never tells the system which side it is
// on, and a malformed request is the harness's fault, never a failure of the system.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TrialFailure, TrialRequest, TrialResult } from "../../src/contracts/index.ts";

const fixture = (kind: string, name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "..", "fixtures", kind, name), "utf8"),
  ) as Record<string, unknown>;

describe("the worker protocol", () => {
  it("has four failure classes, and a malformed request is a protocol failure", () => {
    expect(TrialFailure.shape.class.options).toEqual([
      "infrastructure",
      "system",
      "not_run",
      "protocol",
    ]);
    const bad = TrialResult.parse(fixture("valid-extra", "trialResult/bad-request.json"));
    expect(bad.failure).toEqual({ class: "protocol", kind: "bad-request" });
  });

  it("does not tell the worker whether its arm is the base or the candidate", () => {
    const request = fixture("valid", "trialRequest.json");
    expect(Object.keys(request)).not.toContain("arm");
    expect(JSON.stringify(request)).not.toMatch(/"role"|"base"/);
    // A writer is refused a role, and the arm's name stays an opaque part of the identity.
    expect(
      TrialRequest.safeParse({ ...request, arm: { name: "candidate", role: "candidate" } }).success,
    ).toBe(false);
  });
});
