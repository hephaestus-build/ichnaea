// defineSuite keeps the literal measure keys, so the policy can name only measures the suite has.
import { describe, expectTypeOf, it } from "vitest";

import { defineSuite, type SuiteDefinition } from "../../src/core/index.ts";
import { DEFINITION } from "./support/library.ts";

describe("defineSuite", () => {
  it("keeps the literal measure keys", () => {
    const suite = defineSuite(DEFINITION);
    expectTypeOf(suite).toEqualTypeOf<SuiteDefinition<"answered" | "declines">>();
  });

  it("refuses a limit for a measure the suite does not define, as a type error", () => {
    defineSuite({
      ...DEFINITION,
      policy: {
        ...DEFINITION.policy,
        // @ts-expect-error: 'missing' is not a measure of the suite
        primary: { missing: { margin: 0.1, reason: "r" } },
      },
    });
  });
});
