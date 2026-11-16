import * as z from "zod";

import type { RecordContract } from "./registry.ts";

/** The JSON Schema `$id` of a record contract. Reader schemas add `:reader`. */
export function schemaUri(
  contract: RecordContract,
  variant: "writer" | "reader" = "writer",
): string {
  const [name, major] = contract.id.replace(/^ichnaea\./, "").split("/");
  return `urn:ichnaea:schema:${name}:${major}${variant === "reader" ? ":reader" : ""}`;
}

/**
 * Generates the normative writer JSON Schema 2020-12 of a record contract. Writers are strict: an
 * unknown member is an error, so a misspelt or misplaced member cannot pass unnoticed or leave an
 * identity unchanged. The reader schema (`toReaderJsonSchema`) accepts unknown members.
 */
export function toJsonSchema(contract: RecordContract): Record<string, unknown> {
  const generated = z.toJSONSchema(contract.schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  }) as Record<string, unknown>;
  const { $schema, ...rest } = flatUnions(asciiDigits(nameDefinitions(generated))) as Record<
    string,
    unknown
  >;
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
function flatUnions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(flatUnions);
  if (!node || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, flatUnions(v)]));
  if (Array.isArray(out["oneOf"]))
    out["oneOf"] = (out["oneOf"] as Array<Record<string, unknown>>).flatMap((o) =>
      Object.keys(o).length === 1 && Array.isArray(o["oneOf"]) ? o["oneOf"] : [o],
    );
  return out;
}

/**
 * Rewrites `\d` in patterns as `[0-9]`. In JavaScript `\d` is ASCII, but in other regular
 * expression engines (Python's `re`, .NET) it also matches other Unicode digits, so the same
 * pattern would accept more there.
 */
function asciiDigits(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(asciiDigits);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "pattern" && typeof value === "string"
        ? replaceDigitClass(value)
        : asciiDigits(value),
    ]),
  );
}

function replaceDigitClass(pattern: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === "\\") {
      const next = pattern[i + 1] ?? "";
      out += next === "d" ? (inClass ? "0-9" : "[0-9]") : char + next;
      i++;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    out += char;
  }
  return out;
}

/**
 * zod names anonymous recursive definitions `__schemaN`. The only one in the contracts is the JSON
 * value type, so it gets a stable, readable name. Any other anonymous definition is an error, so a
 * new recursive type gets a deliberate name.
 */
function nameDefinitions(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = schema["$defs"] as Record<string, unknown> | undefined;
  if (!defs) return schema;
  const anonymous = Object.keys(defs).filter((k) => k.startsWith("__schema"));
  if (anonymous.length === 0) return schema;
  if (anonymous.length > 1)
    throw new Error(`unexpected anonymous definitions: ${anonymous.join(", ")}`);
  const from = anonymous[0] as string;
  const text = JSON.stringify(schema).replaceAll(`"#/$defs/${from}"`, '"#/$defs/JsonValue"');
  const renamed = JSON.parse(text) as Record<string, unknown>;
  const renamedDefs = renamed["$defs"] as Record<string, unknown>;
  renamedDefs["JsonValue"] = renamedDefs[from];
  delete renamedDefs[from];
  return renamed;
}

function relax(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relax);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = relax(value);
  // Readers accept members a later minor version adds.
  if (out["additionalProperties"] === false) delete out["additionalProperties"];
  if (out["type"] === "string" && Array.isArray(out["enum"]) && out["x-ichnaea-closed"] !== true) {
    out["x-ichnaea-known"] = out["enum"];
    delete out["enum"];
  }
  const tagged = out["oneOf"];
  if (Array.isArray(tagged)) {
    const discriminator = discriminatorOf(tagged as Array<Record<string, unknown>>);
    if (discriminator) {
      // A kind added later still reads: any object with a string discriminator. With the fallback
      // more than one option can match, so the reader uses anyOf.
      delete out["oneOf"];
      const shared = sharedConstants(tagged as Array<Record<string, unknown>>);
      out["anyOf"] = [
        ...tagged,
        {
          type: "object",
          // Only a kind no known option names: a malformed known kind must still fail. A constant
          // that every known kind fixes, such as the record's `schema` ID, stays strict for it.
          properties: {
            ...shared,
            [discriminator]: {
              type: "string",
              pattern: notOneOf(
                knownKinds(tagged as Array<Record<string, unknown>>, discriminator),
              ),
            },
          },
          required: [...Object.keys(shared), discriminator],
          "x-ichnaea-unknown-kind": true,
        },
      ];
    }
  }
  return out;
}

/** A pattern matching every string except the given ones (a negative lookahead; portable ECMA-262). */
function notOneOf(values: readonly unknown[]): string {
  const escaped = values.map((v) => String(v).replaceAll(/[.*+?^${}()|[\]\\/-]/g, "\\$&"));
  return `^(?!(?:${escaped.join("|")})$)`;
}

/** The members that every option of a tagged union requires and fixes to one same constant. */
function sharedConstants(
  options: ReadonlyArray<Record<string, unknown>>,
): Record<string, { const: unknown }> {
  const first = options[0]?.["properties"] as Record<string, Record<string, unknown>> | undefined;
  const shared: Record<string, { const: unknown }> = {};
  for (const [key, prop] of Object.entries(first ?? {})) {
    if (!("const" in prop)) continue;
    const same = options.every((o) => {
      const other = (o["properties"] as Record<string, Record<string, unknown>> | undefined)?.[key];
      const required = (o["required"] as string[] | undefined)?.includes(key) ?? false;
      return required && other !== undefined && other["const"] === prop["const"];
    });
    if (same) shared[key] = { const: prop["const"] };
  }
  return shared;
}

/** The discriminator values a tagged union already knows. */
function knownKinds(
  options: ReadonlyArray<Record<string, unknown>>,
  discriminator: string,
): unknown[] {
  return [
    ...new Set(
      options.map(
        (o) =>
          (o["properties"] as Record<string, Record<string, unknown>>)[discriminator]?.["const"],
      ),
    ),
  ];
}

/**
 * The member that every option of a tagged union fixes with `const`, to a value of its own. A
 * member that every option fixes to the same value, such as a record's `schema` ID, tells the
 * options apart from nothing, so it is not the tag and stays strict.
 */
function discriminatorOf(options: ReadonlyArray<Record<string, unknown>>): string | undefined {
  const first = options[0]?.["properties"] as Record<string, Record<string, unknown>> | undefined;
  if (!first) return undefined;
  return Object.keys(first).find((key) => {
    const fixed = options.map(
      (o) => (o["properties"] as Record<string, Record<string, unknown>> | undefined)?.[key],
    );
    if (!fixed.every((prop) => prop !== undefined && "const" in prop)) return false;
    return options.length < 2 || new Set(fixed.map((prop) => prop?.["const"])).size > 1;
  });
}

/**
 * The reader variant of a record's JSON Schema (REQ-05): every enumeration of strings becomes a
 * plain string with the known values kept as the `x-ichnaea-known` annotation, and every tagged union
 * gains a fallback option for a kind a later minor version adds. Other constants (the `schema`
 * field) stay strict.
 */
export function toReaderJsonSchema(contract: RecordContract): Record<string, unknown> {
  const writer = toJsonSchema(contract);
  return {
    ...(relax(writer) as Record<string, unknown>),
    $id: schemaUri(contract, "reader"),
    title: `${contract.id} (reader)`,
  };
}
