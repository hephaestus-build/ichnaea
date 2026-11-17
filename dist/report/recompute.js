import { canonicalize } from "../contracts/canonical.js";
import { decide } from "../decide/decide.js";
/**
 * Recomputes a decision from the stored primary records and compares it with the stored decision
 * (REQ-83). Any difference (a changed record, a different statistics version) fails.
 */
export function recompute(records) {
    const again = decide({
        ...records,
        decidedAt: records.decision.decidedAt,
        ichnaea: records.decision.ichnaea,
    });
    const stored = records.decision;
    const fresh = again;
    const differences = [...new Set([...Object.keys(stored), ...Object.keys(fresh)])].filter((k) => canonicalize(stored[k] ?? null) !== canonicalize(fresh[k] ?? null));
    return { matches: differences.length === 0, differences };
}
//# sourceMappingURL=recompute.js.map