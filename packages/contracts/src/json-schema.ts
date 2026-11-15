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
 * Generates the normative JSON Schema 2020-12 of a record contract.
 *
 * The schema is generated for the input side: it does not forbid unknown members, because readers
 * accept unknown fields (REQ-05) and zod strips them on read. Writers emit only known fields.
 */
export function toJsonSchema(contract: RecordContract): Record<string, unknown> {
  const generated = z.toJSONSchema(contract.schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  }) as Record<string, unknown>;
  const { $schema, ...rest } = nameDefinitions(generated);
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
  if (out["type"] === "string" && Array.isArray(out["enum"])) {
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
      out["anyOf"] = [
        ...tagged,
        {
          type: "object",
          properties: { [discriminator]: { type: "string" } },
          required: [discriminator],
          "x-ichnaea-unknown-kind": true,
        },
      ];
    }
  }
  return out;
}

/** The member that every option of a tagged union fixes with `const`. */
function discriminatorOf(options: ReadonlyArray<Record<string, unknown>>): string | undefined {
  const first = options[0]?.["properties"] as Record<string, Record<string, unknown>> | undefined;
  if (!first) return undefined;
  return Object.keys(first).find((key) =>
    options.every((o) => {
      const prop = (o["properties"] as Record<string, Record<string, unknown>> | undefined)?.[key];
      return prop !== undefined && "const" in prop;
    }),
  );
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
