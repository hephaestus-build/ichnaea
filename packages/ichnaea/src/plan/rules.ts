import { canonicalize } from "../contracts/canonical.ts";
import type { Configuration, FactorPart } from "../contracts/records/configuration.ts";
import type { Plan } from "../contracts/records/plan.ts";

/**
 * The parts of a configuration that each trigger varies by its kind (REQ-15). Arms may differ in
 * these parts and in the factor keys a plan declares in `varies`; any other difference between the
 * arms makes the run INVALID. `null` marks a trigger that changes nothing in the system under
 * evaluation (a case set, a judge, the framework itself, a production signal), so its arms may not
 * differ at all and it cannot declare anything as varied. A code or dependency change varies the
 * code, including its lockfile; a prompt or setting it also changes must be declared.
 */
export const TRIGGER_VARIES: { readonly [K in Plan["trigger"]]: readonly FactorPart[] | null } = {
  code: ["code"],
  dependency: ["code"],
  configuration: [],
  "configuration-outside": [],
  "new-model": ["model"],
  "silent-change": [],
  "case-set": null,
  judge: null,
  framework: null,
  data: ["data"],
  "production-signal": null,
  manual: [],
};

/**
 * The identity projection of a configuration as factor keys, each with its part: every model,
 * generation parameter, prompt (by digest) and factor. Two arms with the same keys and values have
 * the same identity.
 */
function identityFactors(
  config: Configuration | undefined,
): Map<string, { readonly value: string; readonly part: FactorPart }> {
  const out = new Map<string, { value: string; part: FactorPart }>();
  if (!config) return out;
  for (const m of config.models)
    out.set(`model.${m.role}`, { value: canonicalize(m), part: "model" });
  for (const p of config.parameters)
    out.set(`parameter.${p.name}`, { value: canonicalize(p), part: "parameter" });
  for (const p of config.prompts)
    out.set(`prompt.${p.name}`, { value: canonicalize([p.digest, p.status]), part: "prompt" });
  for (const [n, f] of Object.entries(config.factors))
    out.set(`factor.${n}`, { value: canonicalize(f), part: f.part });
  return out;
}

/** The factor keys in which two arms differ, with their parts, sorted by key. */
export function configurationDifferences(
  base: Configuration | undefined,
  candidate: Configuration | undefined,
): Array<{ readonly key: string; readonly part: FactorPart }> {
  const fb = identityFactors(base);
  const fc = identityFactors(candidate);
  return [...new Set([...fb.keys(), ...fc.keys()])]
    .filter((k) => fb.get(k)?.value !== fc.get(k)?.value)
    .toSorted()
    .map((key) => ({ key, part: (fb.get(key) ?? fc.get(key))?.part ?? "other" }));
}
