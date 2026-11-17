import { describe, expect, it } from "vitest";

import { fieldsOf, loadSchemas, typeOf } from "../src/reference/schemas.ts";

describe("record schema reference", () => {
  it("loads every writer schema, and no reader schema", () => {
    const names = loadSchemas().map((schema) => schema.name);
    expect(names).toContain("case");
    expect(names).toContain("decision");
    expect(names.some((name) => name.endsWith(".reader"))).toBe(false);
  });

  it("gives each field of the case record its type, whether it is required and its data class", () => {
    const fields = loadSchemas().find((schema) => schema.name === "case")?.fields ?? [];
    const unit = fields.find((field) => field.path === "unit");
    expect(unit?.type).toBe('"turn" | "trace" | "session" | "episode"');
    expect(unit?.required).toBe(true);
    expect(fields.find((field) => field.path === "input")?.data?.class).toBe("inherit");
    expect(fields.find((field) => field.path === "caseSet")?.required).toBe(false);
  });

  it("carries a field's description when the schema has one", () => {
    const node = {
      properties: { a: { type: "string", description: "What a holds." }, b: { type: "string" } },
    };
    expect(fieldsOf(node).map((row) => row.description)).toEqual(["What a holds.", undefined]);
  });

  it.each([
    [{ type: "string", format: "date-time" }, "string (date-time)"],
    [{ type: "number", minimum: 0, maximum: 1 }, "number (≥ 0, ≤ 1)"],
    [{ type: "array", items: { type: "string" } }, "string[]"],
    [{ anyOf: [{ type: "number" }, { const: "nan" }] }, 'number | "nan"'],
    [{ $ref: "#/$defs/JsonValue" }, "JsonValue"],
    [{ type: "object", additionalProperties: { type: "number" } }, "map of number"],
  ])("writes %j as %s", (node, expected) => {
    expect(typeOf(node)).toBe(expected);
  });

  it("writes an array of a union with parentheses, and a union of objects by its count", () => {
    expect(
      typeOf({ type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } }),
    ).toBe("(string | number)[]");
    const objects = {
      oneOf: [
        { type: "object", properties: {} },
        { type: "object", properties: {} },
      ],
    };
    expect(typeOf(objects)).toBe("one of 2 objects");
  });

  it("lists the fields of every variant of a union once, required only when every variant requires them", () => {
    const node = {
      properties: {
        source: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "a" }, shared: { type: "string" } },
              required: ["kind", "shared"],
            },
            {
              type: "object",
              properties: { kind: { const: "b" }, extra: { type: "number" } },
              required: ["kind", "extra"],
            },
          ],
        },
      },
    };
    expect(fieldsOf(node).map((row) => [row.path, row.type, row.required])).toEqual([
      ["source", "one of 2 objects", false],
      ["source.kind", '"a" | "b"', true],
      ["source.shared", "string", false],
      ["source.extra", "number", false],
    ]);
  });

  it("shows the fields of the case provenance and of a comparison's validity results", () => {
    const schemas = new Map(
      loadSchemas().map((schema) => [schema.name, schema.fields.map((field) => field.path)]),
    );
    expect(schemas.get("case")).toContain("provenance.source");
    expect(schemas.get("decision")?.some((path) => path.endsWith("regression.validated"))).toBe(
      true,
    );
  });

  it("lists nested fields under their parent", () => {
    const node = {
      properties: {
        a: { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
        c: { type: "array", items: { type: "object", properties: { d: { type: "number" } } } },
      },
      required: ["a"],
    };
    expect(fieldsOf(node).map((row) => [row.path, row.required])).toEqual([
      ["a", true],
      ["a.b", true],
      ["c", false],
      ["c[].d", false],
    ]);
  });
});
