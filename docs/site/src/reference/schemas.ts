// Reads the record schemas that the package ships, for the reference pages. The JSON Schema files
// are the normative contract, so the pages render them as they are and never restate them.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The package's schema directory, found through its `./schemas/*.json` export. The build bundles
 * this module elsewhere, so a path relative to this file would break.
 */
export const SCHEMA_DIR = dirname(
  createRequire(import.meta.url).resolve("@hephaestus-build/ichnaea/schemas/case.schema.json"),
);

type Node = { readonly [key: string]: unknown };

export interface DataPolicy {
  readonly class: string;
  readonly identifier: string;
  readonly egress: readonly string[];
  readonly retention: string;
}

export interface FieldRow {
  readonly path: string;
  readonly type: string;
  /** What the field holds, from the schema, when the contract describes it. */
  readonly description: string | undefined;
  readonly required: boolean;
  readonly data: DataPolicy | undefined;
}

export interface RecordSchema {
  /** The file name without `.schema.json`, for example `case`. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly stability: string;
  readonly fields: readonly FieldRow[];
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A short type expression for one schema node, such as `string (date-time)` or `"a" | "b"`. */
export function typeOf(node: Node): string {
  if ("const" in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (typeof node.$ref === "string") return node.$ref.split("/").at(-1) ?? node.$ref;
  for (const key of ["anyOf", "oneOf"] as const) {
    const options = node[key];
    if (Array.isArray(options)) return options.filter(isNode).map(typeOf).join(" | ");
  }
  const type = Array.isArray(node.type) ? node.type.join(" | ") : node.type;
  if (type === "array") return `${isNode(node.items) ? typeOf(node.items) : "unknown"}[]`;
  if (type === "object") {
    if (isNode(node.properties)) return "object";
    if (isNode(node.additionalProperties)) return `map of ${typeOf(node.additionalProperties)}`;
    return "object";
  }
  if (typeof type !== "string") return "any JSON value";
  const range = [
    typeof node.minimum === "number" ? `≥ ${node.minimum}` : "",
    typeof node.exclusiveMinimum === "number" ? `> ${node.exclusiveMinimum}` : "",
    typeof node.maximum === "number" ? `≤ ${node.maximum}` : "",
    typeof node.exclusiveMaximum === "number" ? `< ${node.exclusiveMaximum}` : "",
  ].filter(Boolean);
  const notes = [typeof node.format === "string" ? node.format : "", ...range].filter(Boolean);
  return notes.length > 0 ? `${type} (${notes.join(", ")})` : type;
}

function dataPolicy(node: Node): DataPolicy | undefined {
  const data = node["x-ichnaea-data"];
  if (!isNode(data)) return undefined;
  return {
    class: String(data.class),
    identifier: String(data.identifier),
    egress: Array.isArray(data.egress) ? data.egress.map(String) : [],
    retention: String(data.retention),
  };
}

/**
 * The fields of an object node, depth first. A nested object, or an array of objects, adds its own
 * fields under `parent.child` or `parent[].child`.
 */
export function fieldsOf(node: Node, prefix = ""): FieldRow[] {
  const properties = isNode(node.properties) ? node.properties : {};
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  return Object.entries(properties).flatMap(([name, child]) => {
    if (!isNode(child)) return [];
    const path = `${prefix}${name}`;
    const row: FieldRow = {
      path,
      type: typeOf(child),
      description: typeof child.description === "string" ? child.description : undefined,
      required: required.has(name),
      data: dataPolicy(child),
    };
    if (isNode(child.properties)) return [row, ...fieldsOf(child, `${path}.`)];
    if (isNode(child.items) && isNode(child.items.properties))
      return [row, ...fieldsOf(child.items, `${path}[].`)];
    return [row];
  });
}

/** Every writer schema of the package, sorted by name. */
export function loadSchemas(directory = SCHEMA_DIR): RecordSchema[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".schema.json") && !file.endsWith(".reader.schema.json"))
    .toSorted()
    .map((file) => {
      const schema: unknown = JSON.parse(readFileSync(join(directory, file), "utf8"));
      if (!isNode(schema)) throw new Error(`${file} is not a JSON Schema object`);
      return {
        name: file.replace(/\.schema\.json$/, ""),
        title: String(schema.title),
        description: String(schema.description ?? ""),
        stability: String(schema["x-ichnaea-stability"] ?? "unknown"),
        fields: fieldsOf(schema),
      };
    });
}
