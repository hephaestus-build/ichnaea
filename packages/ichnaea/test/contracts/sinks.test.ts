// A delivery sink is tagged by its kind. A remote sink reads its URL from the environment, and only
// a webhook signs, with a signing key from the environment (Standard Webhooks).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ProjectConfig } from "../../src/contracts/index.ts";
import { ajvValidate, createAjv } from "./support/ajv.ts";

const ajv = createAjv();
const project = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "fixtures", "valid", "project.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

function acceptsSink(sink: unknown): boolean {
  const p = project();
  (p["delivery"] as { sinks: Record<string, unknown> }).sinks = { s: sink };
  const zod = ProjectConfig.safeParse(p).success;
  expect(ajvValidate(ajv, "project", p)).toBe(zod);
  return zod;
}

const url = { fromEnv: "SINK_URL" };
const signingKey = { fromEnv: "SINK_SIGNING_KEY" };

describe("delivery sinks", () => {
  it.each(["console", "file", "github"])("a %s sink needs no URL", (kind) => {
    expect(acceptsSink({ kind })).toBe(true);
    expect(acceptsSink({ kind, url })).toBe(false);
  });

  it.each(["teams-workflow", "slack", "otlp"])(
    "a %s sink needs its URL and no signing key",
    (kind) => {
      expect(acceptsSink({ kind, url })).toBe(true);
      expect(acceptsSink({ kind })).toBe(false);
      expect(acceptsSink({ kind, url, signingKey })).toBe(false);
    },
  );

  it("a webhook sink needs its URL and its signing key", () => {
    expect(acceptsSink({ kind: "webhook", url, signingKey })).toBe(true);
    expect(acceptsSink({ kind: "webhook", url })).toBe(false);
    expect(acceptsSink({ kind: "webhook", url, secret: signingKey })).toBe(false);
  });

  it("only a github or a webhook sink takes a clearance grant", () => {
    const clearance = {
      maxExposure: "private",
      purpose: "PU-6",
      reason: "the team's own repository",
    };
    expect(acceptsSink({ kind: "github", clearance })).toBe(true);
    expect(acceptsSink({ kind: "webhook", url, signingKey, clearance })).toBe(true);
    expect(acceptsSink({ kind: "slack", url, clearance })).toBe(false);
    expect(acceptsSink({ kind: "teams-workflow", url, clearance })).toBe(false);
  });
});
