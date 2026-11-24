import * as z from "zod";
import { canonicalize } from "./canonical.js";
import { none } from "./data-class.js";
import { CaseId } from "./primitives.js";
import { candidateRunsFirst } from "./pair-order.js";
/** Each case and replicate gets its own coin. A replacement uses its new physical block index. */
export function pairFirst(seed, block, pair) {
    const identity = canonicalize(["randomized-pair", block, pair.case]);
    return candidateRunsFirst(seed, identity, pair.replicate) ? "candidate" : "base";
}
/** The recorded first arm of one independently assigned case pair. */
export const PairDrawRecord = z.strictObject({
    case: none(CaseId),
    replicate: none(z.int().nonnegative()),
    first: none(z.enum(["base", "candidate"])),
});
//# sourceMappingURL=block-order.js.map