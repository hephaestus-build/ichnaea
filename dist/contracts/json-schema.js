import * as z from "zod";
/** The JSON Schema `$id` of a record contract. Reader schemas add `:reader`. */
export function schemaUri(contract, variant = "writer") {
    const [name, major] = contract.id.replace(/^ichnaea\./, "").split("/");
    return `urn:ichnaea:schema:${name}:${major}${variant === "reader" ? ":reader" : ""}`;
}
/**
 * Generates the normative writer JSON Schema 2020-12 of a record contract. Writers are strict: an
 * unknown member is an error, so a misspelt or misplaced member cannot pass unnoticed or leave an
 * identity unchanged. The reader schema (`toReaderJsonSchema`) accepts unknown members.
 */
export function toJsonSchema(contract) {
    const generated = z.toJSONSchema(contract.schema, {
        target: "draft-2020-12",
        io: "input",
        unrepresentable: "throw",
    });
    const { $schema, ...rest } = flatUnions(asciiDigits(nameDefinitions(generated)));
    return {
        $schema,
        $id: schemaUri(contract),
        title: contract.id,
        description: contract.description,
        "x-ichnaea-stability": contract.stability,
        ...rest,
    };
}
/**
 * zod writes a tagged union inside another (a not-computed power entry, split by its reason) as a
 * `oneOf` inside a `oneOf`. Its options are exclusive with their siblings, so one flat `oneOf` says
 * the same, and the reader schema then sees one tag that every option fixes.
 */
function flatUnions(node) {
    if (Array.isArray(node))
        return node.map(flatUnions);
    if (!node || typeof node !== "object")
        return node;
    const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, flatUnions(v)]));
    if (Array.isArray(out["oneOf"]))
        out["oneOf"] = out["oneOf"].flatMap((o) => Object.keys(o).length === 1 && Array.isArray(o["oneOf"]) ? o["oneOf"] : [o]);
    return out;
}
/**
 * Rewrites `\d` in patterns as `[0-9]`. In JavaScript `\d` is ASCII, but in other regular
 * expression engines (Python's `re`, .NET) it also matches other Unicode digits, so the same
 * pattern would accept more there.
 */
function asciiDigits(node) {
    if (Array.isArray(node))
        return node.map(asciiDigits);
    if (!node || typeof node !== "object")
        return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [
        key,
        key === "pattern" && typeof value === "string"
            ? replaceDigitClass(value)
            : asciiDigits(value),
    ]));
}
function replaceDigitClass(pattern) {
    let out = "";
    let inClass = false;
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === "\\") {
            const next = pattern[i + 1] ?? "";
            out += next === "d" ? (inClass ? "0-9" : "[0-9]") : char + next;
            i++;
            continue;
        }
        if (char === "[")
            inClass = true;
        else if (char === "]")
            inClass = false;
        out += char;
    }
    return out;
}
/**
 * zod names anonymous recursive definitions `__schemaN`. The only one in the contracts is the JSON
 * value type, so it gets a stable, readable name. Any other anonymous definition is an error, so a
 * new recursive type gets a deliberate name.
 */
function nameDefinitions(schema) {
    const defs = schema["$defs"];
    if (!defs)
        return schema;
    const anonymous = Object.keys(defs).filter((k) => k.startsWith("__schema"));
    if (anonymous.length === 0)
        return schema;
    if (anonymous.length > 1)
        throw new Error(`unexpected anonymous definitions: ${anonymous.join(", ")}`);
    const from = anonymous[0];
    const text = JSON.stringify(schema).replaceAll(`"#/$defs/${from}"`, '"#/$defs/JsonValue"');
    const renamed = JSON.parse(text);
    const renamedDefs = renamed["$defs"];
    renamedDefs["JsonValue"] = renamedDefs[from];
    delete renamedDefs[from];
    return renamed;
}
function relax(node) {
    if (Array.isArray(node))
        return node.map(relax);
    if (!node || typeof node !== "object")
        return node;
    const out = {};
    for (const [key, value] of Object.entries(node))
        out[key] = relax(value);
    // Readers accept members a later minor version adds.
    if (out["additionalProperties"] === false)
        delete out["additionalProperties"];
    if (out["type"] === "string" && Array.isArray(out["enum"]) && out["x-ichnaea-closed"] !== true) {
        out["x-ichnaea-known"] = out["enum"];
        delete out["enum"];
    }
    const tagged = out["oneOf"];
    if (Array.isArray(tagged)) {
        const discriminator = discriminatorOf(tagged);
        if (discriminator) {
            // A kind added later still reads: any object with a string discriminator. With the fallback
            // more than one option can match, so the reader uses anyOf.
            delete out["oneOf"];
            out["anyOf"] = [
                ...tagged,
                {
                    type: "object",
                    // Only a kind no known option names: a malformed known kind must still fail.
                    properties: {
                        [discriminator]: {
                            type: "string",
                            pattern: notOneOf(knownKinds(tagged, discriminator)),
                        },
                    },
                    required: [discriminator],
                    "x-ichnaea-unknown-kind": true,
                },
            ];
        }
    }
    return out;
}
/** A pattern matching every string except the given ones (a negative lookahead; portable ECMA-262). */
function notOneOf(values) {
    const escaped = values.map((v) => String(v).replaceAll(/[.*+?^${}()|[\]\\/-]/g, "\\$&"));
    return `^(?!(?:${escaped.join("|")})$)`;
}
/** The discriminator values a tagged union already knows. */
function knownKinds(options, discriminator) {
    return [
        ...new Set(options.map((o) => o["properties"][discriminator]?.["const"])),
    ];
}
/** The member that every option of a tagged union fixes with `const`. */
function discriminatorOf(options) {
    const first = options[0]?.["properties"];
    if (!first)
        return undefined;
    return Object.keys(first).find((key) => options.every((o) => {
        const prop = o["properties"]?.[key];
        return prop !== undefined && "const" in prop;
    }));
}
/**
 * The reader variant of a record's JSON Schema (REQ-05): every enumeration of strings becomes a
 * plain string with the known values kept as the `x-ichnaea-known` annotation, and every tagged union
 * gains a fallback option for a kind a later minor version adds. Other constants (the `schema`
 * field) stay strict.
 */
export function toReaderJsonSchema(contract) {
    const writer = toJsonSchema(contract);
    return {
        ...relax(writer),
        $id: schemaUri(contract, "reader"),
        title: `${contract.id} (reader)`,
    };
}
//# sourceMappingURL=json-schema.js.map