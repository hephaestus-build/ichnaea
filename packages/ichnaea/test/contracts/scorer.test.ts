// The scorer protocol's records. A scorer measures the base's way with the worker's framing, and a
// value it could not give is missing, never a zero or a failure of the system.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  contractFor,
  readRecord,
  ScoreRequest,
  ScoreResult,
  WorkerError,
} from "../../src/contracts/index.ts";

const fixture = (kind: string, name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "..", "fixtures", kind, name), "utf8"),
  ) as Record<string, unknown>;

type Entry = Record<string, unknown>;
const values = (record: Record<string, unknown>): Entry[] => record["values"] as Entry[];

describe("the scorer protocol", () => {
  it("sends the case with its references, the outputs and a scratch directory", () => {
    const request = ScoreRequest.parse(fixture("valid", "scoreRequest.json"));
    expect(contractFor("ichnaea.scoreRequest/1")?.schema).toBe(ScoreRequest);
    expect(request.case.references).toBeDefined();
    expect(request.units[0]?.artifacts?.[0]?.name).toBe("exercise");
    for (const member of ["deadline", "scratch", "units", "measures", "instrument"]) {
      const without = fixture("valid", "scoreRequest.json");
      delete without[member];
      expect(ScoreRequest.safeParse(without).success, member).toBe(false);
    }
    // A request scores at least one unit for at least one measure.
    for (const member of ["units", "measures"])
      expect(ScoreRequest.safeParse({ ...request, [member]: [] }).success, member).toBe(false);
  });

  it("answers each trial and measure with a status, and a value only when it is ok", () => {
    const result = ScoreResult.parse(fixture("valid", "scoreResult.json"));
    expect(contractFor("ichnaea.scoreResult/1")?.schema).toBe(ScoreResult);
    expect(result.values.map((v) => v.status)).toEqual(["ok", "ok", "not_applicable"]);
    const record = fixture("valid", "scoreResult.json");
    const withValue = (entry: Entry): boolean =>
      ScoreResult.safeParse({ ...record, values: [entry] }).success;
    const ok = values(record)[0]!;
    const withoutValue = { ...ok };
    delete withoutValue["value"];
    expect(withValue(withoutValue)).toBe(false);
    // Not applicable is neither a zero nor missing: it carries no value.
    expect(withValue({ ...values(record)[2]!, value: false })).toBe(false);
  });

  it("gives a missing value a reason and never a value, so it is never scored as zero", () => {
    const missing = values(fixture("valid-extra", "scoreResult/judge-reply-unparsable.json"))[0]!;
    expect(missing).toMatchObject({ status: "missing", reason: "JUDGE_REPLY_UNPARSABLE" });
    const record = fixture("valid", "scoreResult.json");
    const parse = (entry: Entry): boolean =>
      ScoreResult.safeParse({ ...record, values: [entry] }).success;
    expect(parse({ ...missing, value: 0 })).toBe(false);
    const withoutReason = { ...missing };
    delete withoutReason["reason"];
    expect(parse(withoutReason)).toBe(false);
  });

  it("echoes the units of a request it cannot serve as protocol errors", () => {
    const result = ScoreResult.parse(fixture("valid-extra", "scoreResult/bad-request.json"));
    for (const value of result.values)
      expect(value).toMatchObject({
        status: "error",
        failure: { class: "protocol", kind: "bad-request" },
      });
    // Without readable unit identities, the scorer writes the worker's error line instead.
    expect(WorkerError.safeParse(fixture("valid", "workerError.json")).success).toBe(true);
  });

  it("takes only a finite number as a value, as strict JSON holds no other", () => {
    const record = fixture("valid", "scoreResult.json");
    const ok = values(record)[0]!;
    const withValue = (value: unknown): boolean =>
      ScoreResult.safeParse({ ...record, values: [{ ...ok, value }] }).success;
    expect(withValue(0.75)).toBe(true);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, { nonFinite: "nan" }])
      expect(withValue(value)).toBe(false);
  });

  it("reads a status that a later minor version adds, and reports it", () => {
    const later = fixture("reader-only", "scoreResult/future-status.json");
    expect(ScoreResult.safeParse(later).success).toBe(false);
    const read = readRecord(contractFor("ichnaea.scoreResult/1")!, later);
    expect(read.ok && read.unknownValues.length).toBeGreaterThan(0);
  });
});
