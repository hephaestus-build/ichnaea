// A tolerantly read trial result is one object, so its members are typed without narrowing a kind.
import { describe, expectTypeOf, it } from "vitest";

import type { ScoreRequestId, TrialId } from "../../src/contracts/index.ts";
import {
  Cancel,
  contractFor,
  isKnownKind,
  readRecord,
  TrialResult,
} from "../../src/contracts/index.ts";

describe("a read trial result", () => {
  it("types its trial's ID and its failure once the read is ok", () => {
    const read = readRecord({ ...contractFor("ichnaea.trialResult/1")!, schema: TrialResult }, {});
    if (!read.ok) return;
    expectTypeOf(read.record.trial.id).toEqualTypeOf<TrialId>();
    expectTypeOf(read.record.usage.calls).toEqualTypeOf<number>();
    if (read.record.failure) expectTypeOf(read.record.failure.kind).toEqualTypeOf<string>();
  });
});

describe("a read cancel", () => {
  it("is narrowed to a known shape, then to a trial or a request", () => {
    const read = readRecord({ ...contractFor("ichnaea.cancel/1")!, schema: Cancel }, {});
    if (!read.ok) return;
    const cancel = read.record;
    // @ts-expect-error a shape that a later minor version adds may have no trial
    expectTypeOf(cancel.trial).toEqualTypeOf<unknown>();
    if (!isKnownKind(cancel, "schema", ["ichnaea.cancel/1"])) return;
    if ("trial" in cancel) expectTypeOf(cancel.trial.id).toEqualTypeOf<TrialId>();
    else expectTypeOf(cancel.request).toEqualTypeOf<ScoreRequestId>();
  });
});
