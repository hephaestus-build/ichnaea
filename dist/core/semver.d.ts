/**
 * Whether a version satisfies a range, as npm reads it. Supported: an exact version, `^x.y.z` (same
 * major; below 1.0 same minor; below 0.1 the same patch), `~x.y.z` (same minor), and `>=x.y.z`.
 * This is the subset peer ranges need.
 */
export declare function satisfies(version: string, range: string): boolean;
//# sourceMappingURL=semver.d.ts.map