// The statistics study workflow (.github/workflows/stats-study.yml) keeps the hardening of the
// confirmation sweep: dispatch only, read-only, no credentials kept, pinned actions and Node, and a
// running study that a second dispatch never cancels.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STUDIES } from "../packages/ichnaea/scripts/stats/study-plan.ts";

const workflow = readFileSync(
  join(import.meta.dirname, "..", ".github", "workflows", "stats-study.yml"),
  "utf8",
);

describe("the statistics study workflow", () => {
  it("runs on a dispatch only, with read access, and keeps no credentials", () => {
    expect(workflow).toMatch(/\non:\n {2}workflow_dispatch:\n/);
    expect(workflow).not.toMatch(/\n {2}(push|pull_request|schedule|workflow_run):/);
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(workflow).not.toMatch(/permissions:\s*\n\s+\w+: write/);
    const checkouts = workflow.split("actions/checkout@").length - 1;
    const kept = workflow.split("persist-credentials: false").length - 1;
    expect(kept).toBe(checkouts);
  });

  it("pins every action to a commit and the jobs to one Node version", () => {
    for (const [, ref] of workflow.matchAll(/uses: [\w./-]+@(\S+)/g))
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    expect(workflow).toContain("\n  NODE_VERSION: 24.22.2\n");
    const setups = workflow.split("actions/setup-node@").length - 1;
    const pinned = workflow.split("node-version: ${{ env.NODE_VERSION }}").length - 1;
    expect(pinned).toBe(setups);
  });

  it("never cancels a running study, and sets no study override", () => {
    // Every heavy run shares one group: a new one queues behind the running one, never cancels it.
    expect(workflow).toMatch(
      /\nconcurrency:\n {2}group: heavy-runners\n {2}cancel-in-progress: false\n/,
    );
    // Any ICHNAEA_* setting makes a run a smoke run, which the collectors refuse without --smoke.
    expect(workflow).not.toContain("ICHNAEA_");
  });

  it("stops a pilot before select, and judges when a job before the verdict failed", () => {
    expect(workflow).toMatch(/\n {2}select:\n[\s\S]*?if: needs\.plan\.outputs\.pilot == 'false'/);
    expect(workflow).toMatch(
      /\n {2}verdict:\n[\s\S]*?if: \$\{\{ !cancelled\(\) && needs\.plan\.result == 'success' && needs\.plan\.outputs\.pilot == 'false' \}\}/,
    );
  });

  // A study is one entry in STUDIES and one option here, added together in the study's own change,
  // so a dispatch never offers a study that the plan cannot run.
  it("offers exactly the studies that the plan knows", () => {
    const options = /\n {6}study:\n[\s\S]*?\n {8}options: \[([^\]]*)\]/.exec(workflow)?.[1];
    expect(options?.split(",").map((o) => o.trim())).toEqual(Object.keys(STUDIES));
  });
});
