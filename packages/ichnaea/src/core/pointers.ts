import * as z from "zod";

import type { Configuration } from "../contracts/index.ts";

import { PlanError } from "./planner.ts";

/**
 * An intended change: a JSON Pointer (RFC 6901) into the keyed view of a configuration, in which
 * `models` are keyed by role and `parameters`, `prompts` and `factors` by name. For example
 * `/prompts/composer`, `/models/answer`, `/parameters/temperature`, or `/factors/code.commit` for
 * the code. `~1` stands for `/` and `~0` for `~` in a name.
 */
export const IntendedChange: z.ZodString = z
  .string()
  .regex(/^(\/([^~/]|~[01])*)+$/, "an intended change is a JSON Pointer such as /prompts/composer");

/** Each top-level member of the keyed view, with the prefix of its factor keys. */
const KINDS: Readonly<Record<string, string>> = {
  models: "model",
  parameters: "parameter",
  prompts: "prompt",
  factors: "factor",
};

/** The factor keys of a configuration, as decide compares arms: `<kind>.<role or name>`. */
function factorKeys(config: Configuration): string[] {
  return [
    ...config.models.map((m) => `model.${m.role}`),
    ...config.parameters.map((p) => `parameter.${p.name}`),
    ...config.prompts.map((p) => `prompt.${p.name}`),
    ...Object.keys(config.factors).map((n) => `factor.${n}`),
  ];
}

const decode = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

/**
 * Maps intended changes onto the factor keys that decide's configuration check reads (`varies`),
 * so the arms may differ in those keys and nowhere else. The mapping is one to one: a pointer
 * names one entry (`/prompts/composer` is `prompt.composer`), or one whole member
 * (`/prompts` is every prompt in either arm). A pointer into a part of an entry, such as
 * `/models/answer/id`, is refused, because the check compares whole entries; declare the entry.
 * A pointer that names nothing in either configuration is refused, so a typo cannot pass as a
 * declaration.
 */
export function intendedFactors(
  pointers: readonly string[],
  base: Configuration,
  candidate: Configuration,
): string[] {
  const known = new Set([...factorKeys(base), ...factorKeys(candidate)]);
  const out = new Set<string>();
  for (const pointer of pointers) {
    const [member = "", name, ...rest] = pointer.slice(1).split("/").map(decode);
    const kind = KINDS[member];
    if (kind === undefined)
      throw new PlanError(
        `intended change '${pointer}' is outside the configuration identity; start it with /models, /parameters, /prompts or /factors`,
      );
    if (rest.length > 0)
      throw new PlanError(
        `intended change '${pointer}' names a part of one entry; the configuration check compares whole entries, so declare '/${member}/${pointer.split("/")[2]}'`,
      );
    const keys =
      name === undefined
        ? [...known].filter((k) => k.startsWith(`${kind}.`))
        : known.has(`${kind}.${name}`)
          ? [`${kind}.${name}`]
          : [];
    if (keys.length === 0)
      throw new PlanError(
        `intended change '${pointer}' names nothing in either configuration; check the role or name`,
      );
    for (const key of keys) out.add(key);
  }
  return [...out].toSorted();
}
