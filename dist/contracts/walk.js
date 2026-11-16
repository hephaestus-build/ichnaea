import * as z from "zod";
import { DATA_POLICY_KEY } from "./data-class.js";
/** The zod definition type of a schema, for structural walks. */
export function defType(schema) {
    return schema._zod.def.type;
}
/** Returns the data policy recorded on a schema or on the schema it wraps (optional, nullable). */
export function policyOf(schema) {
    let current = schema;
    while (current) {
        const meta = z.globalRegistry.get(current);
        const policy = meta?.[DATA_POLICY_KEY];
        if (policy)
            return policy;
        current = wrapped(current);
    }
    return undefined;
}
/** Returns the inner schema of an optional or nullable wrapper. */
export function wrapped(schema) {
    const type = defType(schema);
    if (type === "optional" || type === "nullable" || type === "readonly") {
        return schema._zod.def.innerType;
    }
    return undefined;
}
/** Removes optional, nullable and readonly wrappers. */
export function unwrap(schema) {
    let current = schema;
    for (let inner = wrapped(current); inner; inner = wrapped(current))
        current = inner;
    return current;
}
/** Returns the children of a schema, with a label for error messages. */
export function children(schema) {
    const def = schema._zod.def;
    switch (defType(schema)) {
        case "object": {
            const shape = def["shape"];
            const out = Object.entries(shape);
            // A strict object's catchall is `never` (no other member): nothing to walk.
            const catchall = def["catchall"];
            if (catchall && catchall._zod.def.type !== "never")
                out.push(["*", catchall]);
            return out;
        }
        case "array":
            return [["[]", def["element"]]];
        case "record":
            return [
                ["<key>", def["keyType"]],
                ["<value>", def["valueType"]],
            ];
        case "union":
            return def["options"].map((o, i) => [`|${i}`, o]);
        case "optional":
        case "nullable":
        case "readonly":
        case "nonoptional":
        case "default":
        case "prefault":
        case "catch":
            return [["?", def["innerType"]]];
        case "tuple": {
            const items = def["items"].map((t, i) => [`(${i})`, t]);
            if (def["rest"])
                items.push(["(...)", def["rest"]]);
            return items;
        }
        case "pipe":
            return [
                ["|in", def["in"]],
                ["|out", def["out"]],
            ];
        case "intersection":
            return [
                ["&l", def["left"]],
                ["&r", def["right"]],
            ];
        default:
            return [];
    }
}
//# sourceMappingURL=walk.js.map