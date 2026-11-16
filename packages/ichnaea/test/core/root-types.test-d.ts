// The types that the main export's signatures name are exported from `.` too, as the same
// contract and statistics types, so a consumer needs no other import to write them.
import { describe, expectTypeOf, it } from "vitest";

import type * as contracts from "../../src/contracts/index.ts";
import type * as root from "../../src/index.ts";
import type * as stats from "../../src/stats/index.ts";

describe("the main export", () => {
  it("names the record types of its signatures", () => {
    expectTypeOf<root.Case>().toEqualTypeOf<contracts.Case>();
    expectTypeOf<root.Configuration>().toEqualTypeOf<contracts.Configuration>();
    expectTypeOf<root.TrialResult>().toEqualTypeOf<contracts.TrialResult>();
    expectTypeOf<root.Outcome>().toEqualTypeOf<contracts.Outcome>();
    expectTypeOf<root.Decision>().toEqualTypeOf<contracts.Decision>();
    expectTypeOf<root.Plan>().toEqualTypeOf<contracts.Plan>();
    expectTypeOf<root.Run>().toEqualTypeOf<contracts.Run>();
    expectTypeOf<root.Runtime>().toEqualTypeOf<contracts.Runtime>();
    expectTypeOf<root.Trial>().toEqualTypeOf<contracts.Trial>();
    expectTypeOf<root.MeasureValue>().toEqualTypeOf<contracts.MeasureValue>();
  });

  it("names the statistics types of its signatures", () => {
    expectTypeOf<root.Comparison>().toEqualTypeOf<stats.Comparison>();
    expectTypeOf<root.CaseCounts>().toEqualTypeOf<stats.CaseCounts>();
    expectTypeOf<root.OneTrialChecks>().toEqualTypeOf<stats.OneTrialChecks>();
  });
});
