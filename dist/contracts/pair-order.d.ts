/**
 * Whether the candidate arm runs before the base arm in a case's pair (VALIDATION.md, "One trial per
 * case"). The normative rule, the same in every language: take SHA-256 of the RFC 8785 canonical
 * form of `{ seed, case }` for replicate 0, and of `{ seed, case, replicate }` for a later replicate,
 * with `seed` the plan's seed record and `case` the case ID; the candidate runs first when the lowest
 * bit of the digest's first byte is 1. Replicate 0 keeps the one-trial rule's coin. The planner
 * lists each pair in this order, and `decide` recomputes it to check the records.
 */
export declare function candidateRunsFirst(seed: {
    readonly algorithm: string;
    readonly value: string;
}, caseId: string, replicate?: number): boolean;
/**
 * The opaque names of a plan's base and candidate arms, `a` and `b`, so that no trial ID or trial
 * request tells a system its side. The normative rule, the same in every language: take SHA-256 of
 * the RFC 8785 canonical form of `{ seed, use: "arms" }`, with `seed` the plan's seed record; the
 * base arm is `b` when the lowest bit of the digest's first byte is 1, and `a` otherwise. The plan
 * records each arm's name with its role.
 */
export declare function armNames(seed: {
    readonly algorithm: string;
    readonly value: string;
}): {
    readonly base: "a" | "b";
    readonly candidate: "a" | "b";
};
//# sourceMappingURL=pair-order.d.ts.map