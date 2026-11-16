/** Throws when a count is not a valid binomial count. */
export function assertCount(count, label) {
    const { successes, trials } = count;
    if (!Number.isInteger(successes) ||
        !Number.isInteger(trials) ||
        trials < 0 ||
        successes < 0 ||
        successes > trials) {
        throw new RangeError(`${label}: invalid count ${successes}/${trials}`);
    }
}
/** Throws unless a level is in (0, 1). */
export function assertLevel(level) {
    if (!(level > 0 && level < 1))
        throw new RangeError(`confidence level must be in (0, 1), got ${level}`);
}
//# sourceMappingURL=types.js.map