import { canonicalize } from "./canonical.js";
import { SuiteLock } from "./records/lock.js";
/** A JSON pointer (RFC 6901) to `key` under `at`. */
const pointer = (at, key) => `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
/** The keys of either record, sorted. */
const keysOf = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].toSorted();
/** The pointers below `at` of the entries that one record lacks or holds with another value. */
function differing(at, locked, current) {
    return keysOf(locked, current)
        .filter((k) => !Object.hasOwn(locked, k) ||
        !Object.hasOwn(current, k) ||
        canonicalize(locked[k]) !== canonicalize(current[k]))
        .map((k) => pointer(at, k));
}
/**
 * The entries of a stored lock that differ from the lock that the suite and the checkout give now,
 * as JSON pointers; empty when the lock is current. The lock is stale when the measurement
 * digest, a source, a dataset, an instrument pin, a limit, or a measure's definition or
 * implementation differs. A measure's entry names the part that changed, for example
 * `/measures/grounded/implementation`. The suite's own digest is not compared: a change that
 * leaves what is measured alone, such as the suite's `about`, keeps the lock current.
 */
export function staleLockEntries(locked, current) {
    const a = SuiteLock.parse(locked);
    const b = SuiteLock.parse(current);
    const stale = a.measurementDigest === b.measurementDigest ? [] : ["/measurementDigest"];
    stale.push(...differing("/sources", { ...a.sources }, { ...b.sources }), ...differing("/datasets", a.datasets ?? {}, b.datasets ?? {}), ...differing("/instruments", a.instruments, b.instruments), ...differing("/limits", a.limits, b.limits));
    for (const id of keysOf(a.measures, b.measures)) {
        const before = a.measures[id];
        const after = b.measures[id];
        if (before === undefined || after === undefined)
            stale.push(pointer("/measures", id));
        else
            for (const part of ["definition", "implementation"])
                if (before[part] !== after[part])
                    stale.push(`${pointer("/measures", id)}/${part}`);
    }
    return stale;
}
//# sourceMappingURL=lock-checks.js.map