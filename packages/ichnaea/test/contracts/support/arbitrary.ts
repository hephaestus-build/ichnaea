// Builds fast-check arbitraries from the normative JSON Schema of a contract, so properties run over
// every record shape instead of a few hand-written examples. Generating from the JSON Schema and
// validating with zod also cross-checks the two.
import fc from "fast-check";
import type * as z from "zod";

import { RECORD_CONTRACTS, toJsonSchema } from "../../../src/contracts/index.ts";

type JsonSchema = Record<string, unknown>;

const isoDateTime = fc
  .date({
    min: new Date("2000-01-01T00:00:00Z"),
    max: new Date("2099-12-31T23:59:59Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

/** A pattern with every `(?!…)` group removed, balancing parentheses and skipping escapes. */
function withoutNegativeLookaheads(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      out += pattern.slice(i, i + 2);
      i++;
    } else if (pattern.startsWith("(?!", i)) {
      let depth = 0;
      for (; i < pattern.length; i++) {
        if (pattern[i] === "\\") i++;
        else if (pattern[i] === "(") depth++;
        else if (pattern[i] === ")" && --depth === 0) break;
      }
    } else out += pattern[i];
  }
  return out;
}

function fromJsonSchema(node: JsonSchema): fc.Arbitrary<unknown> {
  if (typeof node["$ref"] === "string") {
    if (node["$ref"] !== "#/$defs/JsonValue")
      throw new Error(`unknown reference ${String(node["$ref"])}`);
    return fc
      .jsonValue({ maxDepth: 2, stringUnit: "grapheme" })
      .map((v) => JSON.parse(JSON.stringify(v)) as unknown);
  }
  if ("const" in node) return fc.constant(node["const"]);
  if (Array.isArray(node["enum"])) return fc.constantFrom(...(node["enum"] as unknown[]));
  for (const key of ["anyOf", "oneOf"]) {
    const options = node[key];
    if (Array.isArray(options))
      return fc.oneof(...(options as JsonSchema[]).map((o) => fromJsonSchema(o)));
  }
  const type = node["type"];
  if (Array.isArray(type))
    return fc.oneof(...type.map((member) => fromJsonSchema({ ...node, type: member })));
  switch (type) {
    case "string": {
      if (node["format"] === "date-time") return isoDateTime;
      if (node["format"] === "date") return isoDateTime.map((s) => s.slice(0, 10));
      if (typeof node["pattern"] === "string") {
        const max = typeof node["maxLength"] === "number" ? node["maxLength"] : 200;
        // fast-check cannot generate from a lookahead, so generate from the pattern without its
        // negative lookaheads and keep the strings that the whole pattern matches.
        const full = new RegExp(node["pattern"]);
        return fc
          .stringMatching(new RegExp(withoutNegativeLookaheads(node["pattern"])))
          .filter((s) => s.length <= max && s.length <= 200 && full.test(s));
      }
      // Full Unicode, including astral characters, so canonical ordering and escaping are tested.
      return fc.string({
        unit: "grapheme",
        minLength: (node["minLength"] as number | undefined) ?? 0,
        maxLength: 12,
      });
    }
    case "integer":
    case "number": {
      const lo =
        (node["minimum"] as number | undefined) ??
        (node["exclusiveMinimum"] as number | undefined) ??
        -1e6;
      const hi =
        (node["maximum"] as number | undefined) ??
        (node["exclusiveMaximum"] as number | undefined) ??
        1e6;
      const exLo = node["exclusiveMinimum"] as number | undefined;
      const exHi = node["exclusiveMaximum"] as number | undefined;
      const inRange = (n: number): boolean =>
        (exLo === undefined || n > exLo) && (exHi === undefined || n < exHi);
      if (node["type"] === "integer") {
        return fc
          .integer({ min: Math.ceil(Math.max(lo, -1e6)), max: Math.floor(Math.min(hi, 1e6)) })
          .filter(inRange);
      }
      return fc
        .double({
          min: Math.max(lo, -1e6),
          max: Math.min(hi, 1e6),
          noNaN: true,
          noDefaultInfinity: true,
        })
        .filter(inRange)
        .map((n) => (Object.is(n, -0) ? 0 : n));
    }
    case "boolean":
      return fc.boolean();
    case "null":
      return fc.constant(null);
    case "array": {
      const min = (node["minItems"] as number | undefined) ?? 0;
      const max = (node["maxItems"] as number | undefined) ?? Math.max(min, 3);
      return fc.array(fromJsonSchema(node["items"] as JsonSchema), {
        minLength: min,
        maxLength: max,
      });
    }
    case "object": {
      const props = (node["properties"] as Record<string, JsonSchema> | undefined) ?? {};
      const required = new Set((node["required"] as string[] | undefined) ?? []);
      const known = Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, fromJsonSchema(v)]),
      );
      const fixed = fc.record(known, {
        requiredKeys: Object.keys(props).filter((k) => required.has(k)),
      });
      const extra = node["additionalProperties"];
      if (extra && typeof extra === "object" && Object.keys(extra).length > 0) {
        const keys = node["propertyNames"]
          ? (fromJsonSchema(node["propertyNames"] as JsonSchema) as fc.Arbitrary<string>)
          : fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 });
        return fc
          .tuple(
            fixed,
            fc.dictionary(
              keys.filter((k) => !Object.hasOwn(props, k)),
              fromJsonSchema(extra as JsonSchema),
              { maxKeys: 3 },
            ),
          )
          .map(([a, b]) => ({ ...b, ...a }));
      }
      return fixed;
    }
    default:
      throw new Error(`no arbitrary for ${JSON.stringify(node).slice(0, 120)}`);
  }
}

/** Returns an arbitrary of records valid under a contract's schema. */
export function arbitraryFor(schema: z.ZodType): fc.Arbitrary<unknown> {
  const contract = RECORD_CONTRACTS.find((c) => c.schema === schema);
  if (!contract) throw new Error("not a registered record contract");
  const json = toJsonSchema(contract);
  return fromJsonSchema(json);
}
