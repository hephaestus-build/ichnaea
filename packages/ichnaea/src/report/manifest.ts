import { digest } from "../contracts/canonical.ts";
import type { Decision } from "../contracts/records/decision.ts";
import type { RunManifest } from "../contracts/run-manifest.ts";
import type { RunRecords } from "../contracts/run-records.ts";

import type { DecisionRecords } from "./recompute.ts";

/** Use canonical record digests so formatting does not affect replay identity. */
export function runManifest(
  records: RunRecords,
  decision: Decision,
  aa: DecisionRecords["aa"] = [],
): RunManifest {
  return {
    schema: "ichnaea.run-manifest/1",
    ichnaea: decision.ichnaea,
    inputs: {
      plan: digest(records.plan),
      run: digest(records.run),
      trials: digest(records.trials),
      values: digest(records.values),
      gates: digest(records.gates),
      aa: digest(aa),
    },
    decision: digest(decision),
  };
}

/** The version and input identity of a later calculation. */
export interface Recalculation {
  readonly schema: "ichnaea.recalculation/1";
  readonly identity: string;
  readonly manifest: string;
  readonly decision: Decision;
}

/** A later calculation has a reproducible identity and retains its original manifest. */
export function recalculation(manifest: RunManifest, decision: Decision): Recalculation {
  const source = digest(manifest);
  return {
    schema: "ichnaea.recalculation/1",
    identity: digest({ manifest: source, ichnaea: decision.ichnaea, decision: digest(decision) }),
    manifest: source,
    decision,
  };
}
