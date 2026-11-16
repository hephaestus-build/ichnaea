// REQ-135: every field of every contract carries a data class, and content fields take the class
// the record declares. The lint walks the normative JSON Schema files.
import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  DATA_POLICY_KEY,
  none,
  RECORD_CONTRACTS,
  type RecordContract,
  toJsonSchema,
} from "../../src/contracts/index.ts";
import { committedSchema } from "./support/ajv.ts";

type JsonSchema = Record<string, unknown>;

/**
 * Returns the paths of leaf fields without a data policy, and whether any field inherits the
 * record's class. A policy on a container classifies its whole subtree, as in the egress projection.
 */
function unclassified(schema: JsonSchema): { missing: string[]; inherits: boolean } {
  const missing: string[] = [];
  let inherits = false;
  const visit = (node: JsonSchema, path: string, classified: boolean): void => {
    const policy = node[DATA_POLICY_KEY] as
      | { class?: string; identifier?: string; egress?: unknown; retention?: string }
      | undefined;
    if (policy?.class === "inherit") inherits = true;
    if (
      policy &&
      (!policy.class ||
        !policy.identifier ||
        !Array.isArray(policy.egress) ||
        !["record", "subject"].includes(policy.retention ?? ""))
    ) {
      missing.push(`${path} (incomplete policy)`);
    }
    const here = classified || policy !== undefined;
    const props = node["properties"] as Record<string, JsonSchema> | undefined;
    const items = node["items"] as JsonSchema | undefined;
    const anyOf = (node["anyOf"] ?? node["oneOf"]) as JsonSchema[] | undefined;
    const extra = node["additionalProperties"] as JsonSchema | undefined;
    if (
      extra &&
      typeof extra === "object" &&
      (extra["properties"] || extra["anyOf"] || extra["oneOf"])
    ) {
      visit(extra, `${path}/*`, here);
    } else if (props) {
      for (const [key, child] of Object.entries(props)) visit(child, `${path}/${key}`, here);
    } else if (items && (items["properties"] || items["anyOf"] || items["oneOf"])) {
      visit(items, `${path}/[]`, here);
    } else if (anyOf && anyOf.some((o) => o["properties"] || o["anyOf"] || o["oneOf"])) {
      anyOf.forEach((o, i) => visit(o, `${path}|${i}`, here));
    } else if (!here) {
      missing.push(path);
    }
  };
  visit(schema, "", false);
  return { missing, inherits };
}

describe("data classes", () => {
  it.each(RECORD_CONTRACTS.map((c) => [c.name] as const))(
    "%s classifies every leaf field",
    (name) => {
      const schema = committedSchema(name);
      const { missing } = unclassified(schema);
      expect(missing).toEqual([]);
    },
  );

  it.each(RECORD_CONTRACTS.map((c) => [c.name] as const))(
    "%s declares dataClass when a field inherits it",
    (name) => {
      const schema = committedSchema(name);
      const { inherits } = unclassified(schema);
      const props = schema["properties"] as Record<string, unknown>;
      if (inherits) expect(Object.keys(props)).toContain("dataClass");
    },
  );

  it("the lint fails on a planted incomplete policy", () => {
    const planted: RecordContract = {
      name: "planted",
      id: "ichnaea.planted/1",
      stability: "development",
      description: "planted",
      schema: z.object({ partial: z.string().meta({ [DATA_POLICY_KEY]: { class: "none" } }) }),
    };
    expect(unclassified(toJsonSchema(planted)).missing).toEqual(["/partial (incomplete policy)"]);
  });

  it("the lint fails on a planted unclassified field", () => {
    const planted: RecordContract = {
      name: "planted",
      id: "ichnaea.planted/1",
      stability: "development",
      description: "planted",
      schema: z.object({ ok: none(z.string()), nested: z.object({ leak: z.string() }) }),
    };
    expect(unclassified(toJsonSchema(planted)).missing).toEqual(["/nested/leak"]);
  });
});
