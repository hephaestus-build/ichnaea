// REQ-148, REQ-14, REQ-10: configuration identity, required factors, case and case-set digests.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  Case as CaseSchema,
  caseDigest,
  caseSetDigest,
  type Configuration,
  Configuration as ConfigurationSchema,
  configurationIdentity,
  IdentityError,
  Trial,
  verifyArms,
} from "../src/index.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", `${name}.json`), "utf8"),
  ) as T;

const uniq = <T>(items: readonly T[], key: (t: T) => string): T[] => [
  ...new Map(items.map((i) => [key(i), i])).values(),
];

/** Removes duplicate roles and names, which have no defined identity. */
function dedupe(config: Configuration): Configuration {
  return {
    ...config,
    models: uniq(config.models, (m) => m.role),
    parameters: uniq(config.parameters, (p) => p.name),
    prompts: uniq(config.prompts, (p) => p.name),
  };
}

describe("configuration identity", () => {
  const base = ConfigurationSchema.parse(fixture("configuration"));

  it("is stable across two resolutions of the same configuration", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryFor(ConfigurationSchema), async (generated) => {
        const config = dedupe(ConfigurationSchema.parse(generated));
        const again: Configuration = {
          ...structuredClone(config),
          models: config.models.toReversed(),
          parameters: config.parameters.toReversed(),
          prompts: config.prompts.toReversed(),
          factors: Object.fromEntries(Object.entries(config.factors).toReversed()),
        };
        expect(await configurationIdentity(again)).toBe(await configurationIdentity(config));
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });

  it.each<[string, (c: Configuration) => void]>([
    ["only the model ID", (c) => (c.models[0]!.id.value = "example-model-2026-11")],
    ["only the provider", (c) => (c.models[0]!.provider.value = "other-provider")],
    ["only a parameter value", (c) => (c.parameters[0]!.value = 0.3)],
    ["only a parameter's origin", (c) => (c.parameters[0]!.origin = "default")],
    [
      "only an application setting",
      (c) =>
        (c.factors["setting.answerLength"] = {
          value: "short",
          status: "declared",
          part: "setting",
        }),
    ],
    [
      "only the model version",
      (c) => (c.models[0]!.version = { value: "2026-10-01", status: "pinned" }),
    ],
    [
      "only the model route",
      (c) => (c.models[0]!.route = { value: "fallback", status: "declared" }),
    ],
    ["only a prompt digest", (c) => (c.prompts[0]!.digest = `sha256:${"9".repeat(64)}`)],
    ["only a factor status", (c) => (c.factors["data.helpCentre"]!.status = "pinned")],
    [
      "only the data digest",
      (c) => (c.factors["data.helpCentre"]!.value = `sha256:${"8".repeat(64)}`),
    ],
  ])("changes when %s changes", async (_, change) => {
    const changed = structuredClone(base);
    change(changed);
    expect(await configurationIdentity(changed)).not.toBe(await configurationIdentity(base));
  });

  it("does not change with the human label", async () => {
    expect(await configurationIdentity({ ...base, label: "candidate B" })).toBe(
      await configurationIdentity(base),
    );
  });

  it("refuses unknown members, so a misspelt or misplaced member cannot leave the identity unchanged", async () => {
    await expect(
      configurationIdentity({ ...structuredClone(base), tools: ["search"] }),
    ).rejects.toThrow();
    const misspelt = {
      ...structuredClone(base),
      models: base.models.map((m) => ({ ...m, versoin: { value: "x", status: "pinned" } })),
    };
    await expect(configurationIdentity(misspelt)).rejects.toThrow();
  });

  it("ignores the description and informational values, such as a provider fingerprint", async () => {
    const described = {
      ...structuredClone(base),
      description: "renamed",
      informational: { "provider.fingerprint": "fp_123" },
    };
    expect(await configurationIdentity(described)).toBe(await configurationIdentity(base));
  });

  it("a per-trial fingerprint lives in the trial, so it never touches the identity", async () => {
    const before = await configurationIdentity(base);
    const trial = Trial.parse({
      schema: "ichnaea.trial/1",
      id: "t",
      source: "offline",
      case: "c",
      unit: "turn",
      configuration: before,
      replicate: 0,
      outcome: "completed",
      dataClass: "none",
      observed: [{ name: "provider.fingerprint", value: "fp_new" }],
    });
    expect(trial.configuration).toBe(before);
    expect(await configurationIdentity(base)).toBe(before);
  });

  it("keeps a __proto__ member as data in the identity", async () => {
    const withProto = JSON.parse(
      JSON.stringify(base).replace(
        '"factors":{',
        '"factors":{"__proto__":{"value":"x","status":"pinned","part":"other"},',
      ),
    ) as unknown;
    expect(Object.hasOwn((withProto as { factors: object }).factors, "__proto__")).toBe(true);
    expect(await configurationIdentity(withProto)).not.toBe(await configurationIdentity(base));
  });

  it("verifies that stored arm identities match their configurations", async () => {
    const identity = await configurationIdentity(base);
    expect(await verifyArms([{ identity, configuration: base }])).toEqual([]);
    const wrong = await verifyArms([{ identity: `sha256:${"0".repeat(64)}`, configuration: base }]);
    expect(wrong).toEqual([
      { path: "/arms/0/identity", stored: `sha256:${"0".repeat(64)}`, computed: identity },
    ]);
  });

  it.each([
    ["model role", (c: Configuration) => c.models.push(structuredClone(c.models[0]!))],
    ["parameter", (c: Configuration) => c.parameters.push(structuredClone(c.parameters[0]!))],
    ["prompt", (c: Configuration) => c.prompts.push(structuredClone(c.prompts[0]!))],
  ])("refuses a duplicate %s, whose identity would depend on order", async (_, add) => {
    const duplicated = structuredClone(base);
    add(duplicated);
    await expect(configurationIdentity(duplicated)).rejects.toThrow(IdentityError);
  });

  it.each<[string, (c: Record<string, unknown>) => void]>([
    ["without models", (c) => delete c["models"]],
    ["without parameters", (c) => delete c["parameters"]],
    ["with no parameter", (c) => (c["parameters"] = [])],
    [
      "with an empty model ID",
      (c) => ((c["models"] as Array<{ id: { value: unknown } }>)[0]!.id.value = ""),
    ],
    [
      "with a null model ID",
      (c) => ((c["models"] as Array<{ id: { value: unknown } }>)[0]!.id.value = null),
    ],
    ["without a description", (c) => delete c["description"]],
  ])("a configuration %s fails validation and has no identity (REQ-14)", async (_, breakIt) => {
    const broken: Record<string, unknown> = structuredClone(base);
    breakIt(broken);
    expect(ConfigurationSchema.safeParse(broken).success).toBe(false);
    await expect(configurationIdentity(broken)).rejects.toThrow();
  });
});

describe("case and case-set digests", () => {
  const record = CaseSchema.parse(fixture("case"));

  it("a case digest refuses members the schema does not define", async () => {
    await expect(caseDigest({ ...record, futureField: [1] })).rejects.toThrow();
  });

  it("changes when any one case changes (REQ-10)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryFor(CaseSchema), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        async (generated, pick) => {
          const cases = generated.map((g, i) => ({ ...CaseSchema.parse(g), id: `c-${i}` }));
          const entries = await Promise.all(
            cases.map(async (c) => ({ id: c.id, digest: await caseDigest(c), pool: c.pool })),
          );
          const index = pick % cases.length;
          const changed = { ...cases[index]!, input: { ...cases[index]!.input, extra: "changed" } };
          const changedEntries = [...entries];
          changedEntries[index] = {
            id: changed.id,
            digest: await caseDigest(changed),
            pool: changed.pool,
          };
          expect(await caseSetDigest(changedEntries as never)).not.toBe(
            await caseSetDigest(entries as never),
          );
          expect(await caseSetDigest(entries.toReversed() as never)).toBe(
            await caseSetDigest(entries as never),
          );
        },
      ),
      { seed: 20261115, numRuns: 100 },
    );
  });

  it("ignores provenance, pool and review status", async () => {
    const reviewed = {
      ...structuredClone(record),
      validation: { status: "validated" },
      pool: "sealed",
    };
    expect(await caseDigest(reviewed)).toBe(await caseDigest(record));
    await expect(caseSetDigest([])).rejects.toThrow(IdentityError);
  });

  it("changes when a case moves to another pool, and refuses duplicate IDs", async () => {
    const entry = { id: record.id, digest: await caseDigest(record), pool: record.pool };
    expect(await caseSetDigest([{ ...entry, pool: "sealed" }])).not.toBe(
      await caseSetDigest([entry]),
    );
    await expect(caseSetDigest([entry, entry])).rejects.toThrow(IdentityError);
  });
});
