/** The most problems that `plainDataProblems` lists before it counts the rest. */
const MAX_PROBLEMS = 100;
/** An array index key: a canonical decimal without leading zeros. */
const INDEX = /^(?:0|[1-9][0-9]*)$/;
/** One path segment of a JSON Pointer (RFC 6901): `~` and `/` are escaped. */
function segment(key) {
    return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}
/** The built-in tag of a value, such as `Map`; it names a built-in from any realm. */
function tag(value) {
    return Object.prototype.toString.call(value).slice("[object ".length, -1);
}
/**
 * Whether a prototype is a realm's `Object.prototype`: its own prototype is null, and its
 * constructor is a function named Object. A class's prototype has `Object.prototype` above it.
 */
function isObjectPrototype(prototype) {
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return (Object.getPrototypeOf(prototype) === null &&
        typeof constructor === "function" &&
        constructor.name === "Object");
}
/** What a value is, when it is not plain JSON data; undefined when it is. */
function notPlain(value) {
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
            if (value === null)
                return undefined;
            const prototype = Object.getPrototypeOf(value);
            // A realm's Array.prototype is itself an array; an Array subclass's prototype is not.
            if (Array.isArray(value) && prototype !== null && Array.isArray(prototype))
                return undefined;
            if (!Array.isArray(value) && (prototype === null || isObjectPrototype(prototype)))
                return undefined;
            const builtin = tag(value);
            if (builtin !== "Object" && builtin !== "Array")
                return builtin;
            const name = value.constructor?.name;
            return typeof name === "string" && name ? `an instance of ${name}` : "an instance of a class";
        }
        default:
            return undefined;
    }
}
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
export function plainDataProblems(value) {
    const problems = [];
    let more = 0;
    const report = (path, what) => {
        if (problems.length < MAX_PROBLEMS)
            problems.push(`${JSON.stringify(path)}: ${what}`);
        else
            more++;
    };
    const open = new Set();
    const checked = new Set();
    const visit = (node, path) => {
        const what = notPlain(node);
        if (what)
            return report(path, what);
        if (typeof node !== "object" || node === null)
            return;
        if (open.has(node))
            return report(path, "a cycle");
        if (checked.has(node))
            return;
        open.add(node);
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                if (Object.hasOwn(node, i))
                    visit(node[i], `${path}/${i}`);
                else
                    report(`${path}/${i}`, "a hole in a sparse array");
            }
            // An own string key that is not an array index is a member that JSON drops.
            for (const key of Object.keys(node))
                if (!INDEX.test(key))
                    report(`${path}/${segment(key)}`, "a member of an array");
        }
        else {
            for (const [key, child] of Object.entries(node))
                visit(child, `${path}/${segment(key)}`);
        }
        if (Object.getOwnPropertySymbols(node).length > 0)
            report(path, "a symbol key");
        open.delete(node);
        checked.add(node);
    };
    visit(value, "");
    if (more > 0)
        problems.push(`and ${more} more`);
    return problems;
}
//# sourceMappingURL=plain-data.js.map