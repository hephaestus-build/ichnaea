import { blockSignP } from "./block-sign.js";
import { createRng } from "./rng.js";
/** The simulation searches a one-point grid for 80% power. */
export const TARGET_BLOCK_POWER = 0.8;
export const BLOCK_POWER_REPETITIONS = 1024;
/** A deterministic power estimate under independent Bernoulli trials and no block shocks. */
export function blockPower(input, drop) {
    const { blocks, replicates, baseRates, level } = input;
    if (2 ** -blocks > level)
        return 0;
    const rng = createRng(20261124);
    const differences = Array.from({ length: blocks }, () => 0);
    const candidateRates = baseRates.map((rate) => Math.max(0, rate - drop));
    let detected = 0;
    for (let repetition = 0; repetition < BLOCK_POWER_REPETITIONS; repetition++) {
        for (let block = 0; block < blocks; block++) {
            let difference = 0;
            for (const [index, rate] of baseRates.entries()) {
                const candidate = candidateRates[index];
                for (let trial = 0; trial < replicates; trial++) {
                    difference += Number(rng.uniform() < candidate) - Number(rng.uniform() < rate);
                }
            }
            differences[block] = difference;
        }
        if (blockSignP(differences) <= level)
            detected++;
    }
    return detected / BLOCK_POWER_REPETITIONS;
}
/** Finds the detectable drop or gives the rejection rate when every candidate trial fails. */
export function blockResolution(input) {
    const extreme = blockPower(input, 1);
    if (extreme < TARGET_BLOCK_POWER)
        return { kind: "extreme", power: extreme };
    let low = 0;
    let high = 100;
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (blockPower(input, middle / 100) >= TARGET_BLOCK_POWER)
            high = middle;
        else
            low = middle;
    }
    return { kind: "detectable-drop", drop: high / 100 };
}
/** The default planning model spans base rates from 60% to 100%. */
export function defaultBaseRates(cases) {
    return Array.from({ length: cases }, (_, index) => 0.6 + (0.4 * index) / Math.max(1, cases - 1));
}
//# sourceMappingURL=block-resolution.js.map