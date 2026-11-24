import * as z from "zod";

import { canonicalize } from "./canonical.ts";
import { none } from "./data-class.ts";
import { CaseId } from "./primitives.ts";
import { candidateRunsFirst } from "./pair-order.ts";

type ArmRole = "base" | "candidate";

interface PairKey {
  readonly case: string;
  readonly replicate: number;
}

export interface PairDraw extends PairKey {
  readonly first: ArmRole;
}

/** Each case and replicate gets its own coin. A replacement uses its new physical block index. */
export function pairFirst(
  seed: Parameters<typeof candidateRunsFirst>[0],
  block: number,
  pair: PairKey,
): ArmRole {
  const identity = canonicalize(["randomized-pair", block, pair.case]);
  return candidateRunsFirst(seed, identity, pair.replicate) ? "candidate" : "base";
}

/** The recorded first arm of one independently assigned case pair. */
export const PairDrawRecord: z.ZodType<PairDraw> = z.strictObject({
  case: none(CaseId),
  replicate: none(z.int().nonnegative()),
  first: none(z.enum(["base", "candidate"])),
});
