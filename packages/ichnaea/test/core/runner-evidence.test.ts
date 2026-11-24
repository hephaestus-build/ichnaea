import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import { TrialRequest, TrialResult } from "../../src/contracts/records/worker.ts";
import { workerEvidence } from "../../src/core/runner-evidence.ts";

const request = TrialRequest.parse(
  JSON.parse(
    await readFile(new URL("../../fixtures/valid/trialRequest.json", import.meta.url), "utf8"),
  ),
);
const result = TrialResult.parse(
  JSON.parse(
    await readFile(new URL("../../fixtures/valid/trialResult.json", import.meta.url), "utf8"),
  ),
);
const configuration = `sha256:${"d".repeat(64)}`;
const meta = {
  run: "evidence",
  block: 4,
  analysisPlan: request.plan,
  configuration,
  settings: configuration,
  startedAt: "2026-11-24T12:00:01.000Z",
  endedAt: "2026-11-24T12:00:02.000Z",
};
const observed = { kind: "settings" as const, configuration };
const reply = { ...result, observed, context: "instance-9" };

it("attaches the locked analysis, context and observed settings to captured output", () => {
  const captured = workerEvidence(request, reply, meta);
  expect(captured).toMatchObject({
    outcome: "completed",
    analysisPlan: request.plan,
    block: 4,
    context: "instance-9",
    output: result.output,
    observed: [{ name: "configuration-file", value: configuration }],
    usage: { calls: 3, wallMs: 1_000 },
  });
});

it("counts a truncation as missing and keeps the actual calls even when the worker overran", () => {
  const truncated = workerEvidence(request, { ...reply, truncated: true }, meta);
  expect(truncated).toMatchObject({
    outcome: "infrastructure_failure",
    error: { kind: "not-captured" },
  });
  expect(truncated.output).toBeUndefined();
  const overrun = workerEvidence(
    request,
    { ...reply, usage: { calls: 15, responseIds: [] } },
    meta,
  );
  expect(overrun).toMatchObject({ outcome: "budget_exceeded", usage: { calls: 15 } });
  expect(overrun.output).toBeUndefined();
});

it("refuses unrelated settings and an unclassifiable result before admitting output", () => {
  const changed = workerEvidence(
    request,
    { ...reply, observed: { ...observed, configuration: request.plan } },
    meta,
  );
  expect(changed.outcome).toBe("invalid_configuration");
  expect(changed.output).toBeUndefined();
  const protocol = workerEvidence({ ...request, dataClass: "personal" }, reply, meta);
  expect(protocol).toMatchObject({ outcome: "protocol_failure", dataClass: "personal" });
  expect(protocol.output).toBeUndefined();
});
