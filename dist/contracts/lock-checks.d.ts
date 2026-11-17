/**
 * The entries of a stored lock that differ from the lock that the suite and the checkout give now,
 * as JSON pointers; empty when the lock is current. The lock is stale when the measurement
 * digest, a source, a dataset, an instrument pin, a limit, or a measure's definition or
 * implementation differs. A measure's entry names the part that changed, for example
 * `/measures/grounded/implementation`. The suite's own digest is not compared: a change that
 * leaves what is measured alone, such as the suite's `about`, keeps the lock current.
 */
export declare function staleLockEntries(locked: unknown, current: unknown): string[];
//# sourceMappingURL=lock-checks.d.ts.map