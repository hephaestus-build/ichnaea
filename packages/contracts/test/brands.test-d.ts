// REQ-107: branded identifiers cannot be mixed up at compile time.
import { describe, expectTypeOf, it } from "vitest";

import type {
  CaseId,
  ConfigurationIdentity,
  Digest,
  MeasureId,
  PlanDigest,
  TrialId,
} from "../src/index.ts";
import { CaseId as CaseIdSchema, Trial } from "../src/index.ts";

const takesCase = (id: CaseId): CaseId => id;

describe("branded identifiers", () => {
  it("keeps a TrialId apart from a CaseId", () => {
    expectTypeOf<TrialId>().not.toMatchTypeOf<CaseId>();
    expectTypeOf<CaseId>().not.toMatchTypeOf<TrialId>();
    expectTypeOf<MeasureId>().not.toMatchTypeOf<CaseId>();
    expectTypeOf<PlanDigest>().not.toMatchTypeOf<ConfigurationIdentity>();
    expectTypeOf<PlanDigest>().toMatchTypeOf<Digest>();
  });

  it("does not accept a plain string where a CaseId is expected", () => {
    // @ts-expect-error a plain string is not a CaseId
    takesCase("c-1");
    takesCase(CaseIdSchema.parse("c-1"));
    const trial = Trial.parse({});
    // @ts-expect-error a TrialId is not a CaseId
    takesCase(trial.id);
  });
});
