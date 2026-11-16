/** One path segment of a JSON Pointer (RFC 6901): `~` and `/` are escaped. */
function segment(key: string | number): string {
  return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

/** What a value is, when it is not plain JSON data; undefined when it is. */
function notPlain(value: unknown): string | undefined {
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "number":
      return Number.isFinite(value) ? undefined : String(value);
    case "function":
      return "a function";
    case "symbol":
      return "a symbol";
    case "bigint":
      return "a bigint";
    case "object": {
      if (value === null || Array.isArray(value)) return undefined;
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === null) return undefined;
      for (const builtin of [Map, Set, Date, RegExp, WeakMap, WeakSet, Promise])
        if (value instanceof builtin) return builtin.name;
      const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
      return typeof name === "string" && name ? `an instance of ${name}` : "an instance of a class";
    }
    default:
      return undefined;
  }
}

/**
 * Names every field of a value that is not plain JSON data, as `<JSON Pointer>: <what it is>`, with
 * `/` for the root. Plain data is objects whose prototype is `Object.prototype` or null, dense
 * arrays, strings, finite numbers, booleans and null. A function, undefined, a Map, a Set, a Date, a
 * RegExp, a class instance, NaN, an infinity, a symbol (as a value or a key), a bigint, a hole in a
 * sparse array and a cycle are named, because `JSON.stringify` would drop or change each silently.
 * The record schemas validate JSON values only, so a loader calls this first and refuses the value
 * when the list is not empty. It is pure, and it does not descend into a value it names.
 */
export function plainDataProblems(value: unknown): string[] {
  const problems: string[] = [];
  const open = new Set<object>();
  const visit = (node: unknown, path: string): void => {
    const at = path || "/";
    const what = notPlain(node);
    if (what) {
      problems.push(`${at}: ${what}`);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (open.has(node)) {
      problems.push(`${at}: a cycle`);
      return;
    }
    open.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (Object.hasOwn(node, i)) visit(node[i], `${path}/${i}`);
        else problems.push(`${path}/${i}: a hole in a sparse array`);
      }
    } else {
      for (const [key, child] of Object.entries(node)) visit(child, `${path}/${segment(key)}`);
      if (Object.getOwnPropertySymbols(node).length > 0) problems.push(`${at}: a symbol key`);
    }
    open.delete(node);
  };
  visit(value, "");
  return problems;
}
