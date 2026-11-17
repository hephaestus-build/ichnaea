/**
 * Names every field of a value that is not plain JSON data, as `"<JSON Pointer>": <what it is>`.
 * The pointer is quoted, and the root's pointer is `""`. Plain data is objects whose prototype is
 * a realm's `Object.prototype` or null, dense arrays of a realm's `Array` with no other members,
 * strings, finite numbers, booleans and null. A function, undefined, a Map, a Set, a Date, a
 * RegExp, a class instance, an Array subclass, NaN, an infinity, a symbol (as a value or a key),
 * a bigint, a hole in a sparse array, a member of an array that is not an index, and a cycle are
 * named, because `JSON.stringify` would drop or change each silently.
 *
 * The record schemas validate JSON values only, so a loader calls this first and refuses the value
 * when the list is not empty. It is pure and linear: an object reached twice is checked once and
 * named at its first path, and after 100 problems the last entry counts the rest
 * (`and 42 more`).
 */
export declare function plainDataProblems(value: unknown): string[];
//# sourceMappingURL=plain-data.d.ts.map