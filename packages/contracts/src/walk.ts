import * as z from "zod";

import { DATA_POLICY_KEY, type DataPolicy } from "./data-class.ts";

/** The zod definition type of a schema, for structural walks. */
export function defType(schema: z.ZodType): string {
  return schema._zod.def.type;
}

/** Returns the data policy recorded on a schema or on the schema it wraps (optional, nullable). */
export function policyOf(schema: z.ZodType): DataPolicy | undefined {
  let current: z.ZodType | undefined = schema;
  while (current) {
    const meta = z.globalRegistry.get(current) as Record<string, unknown> | undefined;
    const policy = meta?.[DATA_POLICY_KEY] as DataPolicy | undefined;
    if (policy) return policy;
    current = wrapped(current);
  }
  return undefined;
}

/** Returns the inner schema of an optional or nullable wrapper. */
export function wrapped(schema: z.ZodType): z.ZodType | undefined {
  const type = defType(schema);
  if (type === "optional" || type === "nullable" || type === "readonly") {
    return (schema._zod.def as unknown as { innerType: z.ZodType }).innerType;
  }
  return undefined;
}

/** Removes optional, nullable and readonly wrappers. */
export function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let inner = wrapped(current); inner; inner = wrapped(current)) current = inner;
  return current;
}

/** Returns the children of a schema, with a label for error messages. */
export function children(schema: z.ZodType): Array<[string, z.ZodType]> {
  const def = schema._zod.def as unknown as Record<string, unknown>;
  switch (defType(schema)) {
    case "object": {
      const shape = def["shape"] as Record<string, z.ZodType>;
      const out: Array<[string, z.ZodType]> = Object.entries(shape);
      if (def["catchall"]) out.push(["*", def["catchall"] as z.ZodType]);
      return out;
    }
    case "array":
      return [["[]", def["element"] as z.ZodType]];
    case "record":
      return [
        ["<key>", def["keyType"] as z.ZodType],
        ["<value>", def["valueType"] as z.ZodType],
      ];
    case "union":
      return (def["options"] as z.ZodType[]).map((o, i) => [`|${i}`, o]);
    case "optional":
    case "nullable":
    case "readonly":
      return [["?", def["innerType"] as z.ZodType]];
    case "intersection":
      return [
        ["&l", def["left"] as z.ZodType],
        ["&r", def["right"] as z.ZodType],
      ];
    default:
      return [];
  }
}
