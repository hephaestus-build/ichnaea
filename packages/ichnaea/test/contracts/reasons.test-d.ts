// A reason's parameters are typed per code, so a producer cannot emit a reason whose card line
// would miss a slot.
import { describe, expectTypeOf, it } from "vitest";

import type { ReasonCode, ReasonInstance, ReasonParams } from "../../src/contracts/index.ts";

describe("ReasonParams", () => {
  it("has a parameter type for every code and no other", () => {
    expectTypeOf<keyof ReasonParams>().toEqualTypeOf<ReasonCode>();
  });

  it("accepts a reason with its parameters", () => {
    expectTypeOf({
      code: "ANSWER_LENGTH_OUTSIDE" as const,
      params: { median: 1840, p5: 210, p95: 1320 },
    }).toExtend<ReasonInstance>();
    expectTypeOf({ code: "PASS" as const, params: {} }).toExtend<ReasonInstance>();
  });

  it("refuses a reason with a missing or a wrong parameter", () => {
    expectTypeOf({
      code: "ANSWER_LENGTH_OUTSIDE" as const,
      params: { median: 1840, p5: 210 },
    }).not.toExtend<ReasonInstance>();
    expectTypeOf({
      code: "JUDGE_MODEL_NOT_COVERED" as const,
      params: { observed: "judge-b", covered: "judge-a" },
    }).not.toExtend<ReasonInstance>();
  });
});
