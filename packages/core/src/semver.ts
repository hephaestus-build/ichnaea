/** A parsed semantic version (pre-release tags compare as lower than the release). */
interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: boolean;
}

function parse(version: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+.*)?$/.exec(version.trim());
  if (!match) throw new RangeError(`not a semantic version: '${version}'`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] !== undefined,
  };
}

function compare(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    (a.pre === b.pre ? 0 : a.pre ? -1 : 1)
  );
}

/**
 * Whether a version satisfies a range. Supported: an exact version, `^x.y.z` (same major; below 1.0
 * same minor), `~x.y.z` (same minor), and `>=x.y.z`. This is the subset peer ranges need.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  const r = range.trim();
  if (r.startsWith(">=")) return compare(v, parse(r.slice(2))) >= 0;
  if (r.startsWith("^")) {
    const base = parse(r.slice(1));
    if (compare(v, base) < 0) return false;
    if (base.major > 0) return v.major === base.major;
    return v.major === 0 && v.minor === base.minor;
  }
  if (r.startsWith("~")) {
    const base = parse(r.slice(1));
    return compare(v, base) >= 0 && v.major === base.major && v.minor === base.minor;
  }
  return compare(v, parse(r)) === 0;
}
