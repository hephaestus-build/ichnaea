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
export declare function pairFirst(seed: Parameters<typeof candidateRunsFirst>[0], block: number, pair: PairKey): ArmRole;
export {};
//# sourceMappingURL=block-order.d.ts.map