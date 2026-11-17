// Every `calls` in the records counts the calls the provider accepted. A call the provider
// rejected, for example with HTTP 429, is not a call, so a throttled trial is never over its bound
// for the calls it retried. The rule reaches the generated JSON Schemas, writer and reader.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schemas = join(import.meta.dirname, "..", "..", "schemas");
const schema = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(schemas, file), "utf8")) as Record<string, unknown>;
// `union` steps into a union's options: `oneOf` in a writer schema, `anyOf` in a reader schema.
const at = (node: unknown, path: readonly string[]): { description?: string } =>
  (path.reduce<unknown>((n, key) => {
    const object = n as Record<string, unknown> | undefined;
    return key === "union" ? (object?.["oneOf"] ?? object?.["anyOf"]) : object?.[key];
  }, node) ?? {}) as { description?: string };

const FIELDS: readonly [string, readonly string[]][] = [
  ["trial", ["properties", "usage", "properties", "calls"]],
  ["trial", ["properties", "attempts", "items", "properties", "calls"]],
  ["trialResult", ["properties", "usage", "properties", "calls"]],
  ["workerEvent", ["union", "0", "properties", "calls"]],
  ["trialRequest", ["properties", "limits", "properties", "calls"]],
];

describe("every calls field", () => {
  it.each(
    FIELDS.flatMap(([record, path]) =>
      ["schema", "reader.schema"].map((kind) => [`${record}.${kind}`, path.join("/")] as const),
    ),
  )("%s /%s counts only the calls the provider accepted", (file, path) => {
    const { description } = at(schema(`${file}.json`), path.split("/"));
    expect(description).toMatch(/calls the provider accepted/);
    expect(description).toMatch(/rejected.*(429).*is not a call/);
  });
});
