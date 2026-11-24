// The comparison as it will be once the validated margin floor is set, for tests of the rule that
// PASS and NON-INFERIOR need (decision 0015). The statistics constant itself is never changed.
import type { Decision } from "../../../src/contracts/index.ts";
import {
  type Comparison,
  type ComparisonInput,
  compareCounts,
  MARGIN_FLOOR_NOT_SET,
} from "../../../src/stats/index.ts";

import { type DecideInput, decideWith } from "../../../src/decide/decide.ts";
import type { Scenario } from "./scenario.ts";

/**
 * `compareCounts` with the floor's absence removed from the non-inferiority result's limitations:
 * the same numbers, and a non-inferiority result validated where that was its only limitation.
 */
export function floorSet(input: ComparisonInput): Comparison {
  const c = compareCounts(input);
  const limitations = c.nonInferiority.limitations.filter((l) => l !== MARGIN_FLOOR_NOT_SET);
  return { ...c, nonInferiority: { validated: limitations.length === 0, limitations } };
}

/** Decides a scenario as if the floor were set. */
export const decideFloorSet = (
  s: Scenario | Omit<DecideInput, "decidedAt" | "ichnaea">,
): Decision => decideWith({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" }, floorSet);

/** The reason of a run that does not regress while the floor is not set. */
