// REQ-22, REQ-25: the worker protocol's records. A request never tells the system which side it is
// on, and a malformed request is the harness's fault, never a failure of the system.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  contractFor,
  readRecord,
  TrialFailure,
  TrialRequest,
  TrialResult,
  WorkerError,
} from "../../src/contracts/index.ts";

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
    // The arm's name, and the trial ID that holds it, never say which side the arm is: not in the
    // request, and not in the result that echoes its identity.
    for (const record of [request, fixture("valid", "trialResult.json")]) {
      const trial = record["trial"] as { id: string; arm: string };
      expect(trial.arm).not.toMatch(/candidate|base/i);
      expect(trial.id).not.toMatch(/candidate|base/i);
    }
    // A writer is refused a role, and the arm's name stays an opaque part of the identity.
    expect(
      TrialRequest.safeParse({ ...request, arm: { name: "candidate", role: "candidate" } }).success,
    ).toBe(false);
  });

  it("answers a request line it cannot read with a worker error that names no trial", () => {
    expect(
      WorkerError.safeParse({
        schema: "ichnaea.workerError/1",
        dataClass: "none",
        kind: "bad-json",
      }).success,
    ).toBe(true);
    // A guessed identity would attach the error to the wrong trial, so a writer refuses one.
    const guessed = {
      ...fixture("valid", "workerError.json"),
      trial: fixture("valid", "trialResult.json")["trial"],
    };
    expect(WorkerError.safeParse(guessed).success).toBe(false);
  });

  it("carries no content in a worker error, so the worker never guesses a data class", () => {
    const valid = fixture("valid", "workerError.json");
    // A worker that cannot read a line cannot know its class, so the record is always class none.
    expect(WorkerError.safeParse({ ...valid, dataClass: "personal" }).success).toBe(false);
    // The message is classed none in the published schema, so it can never carry the line's content.
    const schema = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "schemas", "workerError.schema.json"),
        "utf8",
      ),
    ) as { properties: { message: { "x-ichnaea-data": { class: string } } } };
    expect(schema.properties.message["x-ichnaea-data"].class).toBe("none");
  });

  it("still needs the request's identity on a protocol failure", () => {
    const anonymous = fixture("valid-extra", "trialResult/bad-request.json");
    delete anonymous["trial"];
    expect(TrialResult.safeParse(anonymous).success).toBe(false);
  });

  it("refuses a short commit next to an image in the writer and the reader alike", () => {
    const result = fixture("valid", "trialResult.json");
    const withCode = (code: Record<string, unknown>): Record<string, unknown> => ({
      ...result,
      observed: { ...(result["observed"] as Record<string, unknown>), code },
    });
    const contract = contractFor("ichnaea.trialResult/1")!;
    const image = `sha256:${"b2".repeat(32)}`;
    const short = withCode({ image, commit: "abc" });
    expect(TrialResult.safeParse(short).success).toBe(false);
    expect(readRecord(contract, short).ok).toBe(false);
    const full = withCode({ image, commit: "0123456789abcdef0123456789abcdef01234567" });
    expect(TrialResult.safeParse(full).success).toBe(true);
    expect(readRecord(contract, full).ok).toBe(true);
  });
});
