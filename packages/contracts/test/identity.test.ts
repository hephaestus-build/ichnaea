// REQ-148, REQ-14, REQ-10: configuration identity, required factors, case-set digests.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type Case,
  Case as CaseSchema,
  caseDigest,
  caseSetDigest,
  type Configuration,
  Configuration as ConfigurationSchema,
  configurationIdentity,
} from "../src/index.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", `${name}.json`), "utf8"),
  ) as T;

describe("configuration identity", () => {
  const base = ConfigurationSchema.parse(fixture("configuration"));

  it("is stable across two resolutions of the same configuration", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryFor(ConfigurationSchema), async (generated) => {
        const config = ConfigurationSchema.parse(generated);
        const again: Configuration = {
          ...structuredClone(config),
          models: config.models.toReversed(),
          prompts: config.prompts.toReversed(),
          parameters: Object.fromEntries(Object.entries(config.parameters).toReversed()),
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
    ["only a parameter", (c) => (c.parameters["answer.temperature"]!.value = 0.3)],
    [
      "only an application setting",
      (c) =>
        (c.factors["setting.answerLength"] = {
          value: "short",
          status: "declared",
          part: "setting",
        }),
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

  it("has no place for a provider fingerprint: fingerprints are observed per trial and never invalidate", () => {
    const withFingerprint = { ...base, fingerprint: "fp_123" };
    // Unknown fields are stripped on read, so a fingerprint cannot enter the identity.
    expect(Object.keys(ConfigurationSchema.parse(withFingerprint))).not.toContain("fingerprint");
  });

  it.each(["models", "parameters", "description"])(
    "a configuration without %s fails validation (REQ-14)",
    (field) => {
      const broken: Record<string, unknown> = structuredClone(base);
      delete broken[field];
      expect(ConfigurationSchema.safeParse(broken).success).toBe(false);
    },
  );
});

describe("case-set digest", () => {
  const record = CaseSchema.parse(fixture("case"));

  it("changes when any one case changes (REQ-10)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryFor(CaseSchema), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        async (generated, pick) => {
          const cases = generated.map((g, i) => ({ ...CaseSchema.parse(g), id: `c-${i}` }) as Case);
          const entries = await Promise.all(
            cases.map(async (c) => ({ id: c.id, digest: await caseDigest(c), pool: c.pool })),
          );
          const index = pick % cases.length;
          const changed = {
            ...cases[index]!,
            input: { ...cases[index]!.input, extra: "changed" },
          } as Case;
          const changedEntries = [...entries];
          changedEntries[index] = {
            id: changed.id,
            digest: await caseDigest(changed),
            pool: changed.pool,
          };
          expect(await caseSetDigest(changedEntries)).not.toBe(await caseSetDigest(entries));
          expect(await caseSetDigest(entries.toReversed())).toBe(await caseSetDigest(entries));
        },
      ),
      { seed: 20261115, numRuns: 100 },
    );
  });

  it("changes when a case moves to another pool", async () => {
    const entry = { id: record.id, digest: await caseDigest(record), pool: record.pool };
    expect(await caseSetDigest([{ ...entry, pool: "sealed" }])).not.toBe(
      await caseSetDigest([entry]),
    );
  });
});
