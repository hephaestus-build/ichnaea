import { canonicalize } from "./canonical.js";
import { candidateRunsFirst } from "./pair-order.js";
/** Each case and replicate gets its own coin. A replacement uses its new physical block index. */
export function pairFirst(seed, block, pair) {
    const identity = canonicalize(["randomized-pair", block, pair.case]);
    return candidateRunsFirst(seed, identity, pair.replicate) ? "candidate" : "base";
}
//# sourceMappingURL=block-order.js.map