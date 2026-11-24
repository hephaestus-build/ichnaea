import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { join } from "node:path";

import { expect, it } from "vitest";

const exec = promisify(execFile);
const bin = join(import.meta.dirname, "../../src/core/bin.ts");
const worker = join(import.meta.dirname, "fixtures/worker-check.ts");

function check(mode: string, command = worker) {
  return exec(
    process.execPath,
    [bin, "worker", "check", "--json", "--", process.execPath, command, mode],
    { timeout: 7_500 },
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

it("checks a real command worker whose results come back out of order", async () => {
  const checked = await check("reverse");
  expect(checked.code, checked.stderr).toBe(0);
  expect(JSON.parse(checked.stdout)).toMatchObject({
    capacity: 2,
    replies: ["vector/2", "vector/1"],
  });
  expect(checked.stderr.trim()).toBe("[worker] fixture ready");
});

it("runs the same vectors against the serving helper at capacity one", async () => {
  const command = join(import.meta.dirname, "fixtures", "serve-worker.ts");
  const checked = await check("default", command);
  expect(checked.code, checked.stderr).toBe(0);
  expect(JSON.parse(checked.stdout)).toMatchObject({
    capacity: 1,
    replies: ["vector/1", "vector/2"],
  });
});

it.each([
  ["unknown", "unknown attempt"],
  ["duplicate", "duplicate result"],
  ["late", "did not answer before the deadline"],
])("refuses a %s result through the shipped worker check command", async (mode, message) => {
  const checked = await check(mode);
  expect(checked.code, checked.stderr).toBe(2);
  expect(JSON.parse(checked.stdout)).toMatchObject({
    schema: "ichnaea.cli.error/1",
    message: expect.stringContaining(message),
  });
});
