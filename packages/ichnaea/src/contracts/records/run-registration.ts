import * as z from "zod";

import { none } from "../data-class.ts";
import { ConfigurationIdentity, RunId } from "../primitives.ts";

/** A decision result when a run supports a verdict. */
export const Verdict = z.enum(["PASS", "REGRESSION", "INCONCLUSIVE", "INVALID"]);

export const RunPurpose = z.enum(["development", "regression", "confirmation"]);
export const Registration = none(z.enum(["registered", "unregistered", "exploratory"]));
export const CandidateHistory = z.strictObject({
  scope: none(z.enum(["store", "records"])),
  candidates: z.array(
    z.strictObject({
      run: none(RunId),
      candidate: none(ConfigurationIdentity),
      verdict: none(Verdict.nullable()),
    }),
  ),
});
