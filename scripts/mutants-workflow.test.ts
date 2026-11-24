// The mutants workflow runs every mutant script, so that no present-tense mutation claim rests on
// mutants that never run. A new mutant script that the workflow does not run fails this test.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
interface Step {
  readonly id?: string;
  readonly run?: string;
  readonly if?: string | boolean;
  readonly env?: Record<string, string>;
  readonly "working-directory"?: string;
  readonly "continue-on-error"?: boolean;
}
interface Workflow {
  readonly on: Record<
    string,
    { branches?: string[]; paths?: unknown; "paths-ignore"?: unknown } | null
  >;
  readonly jobs: Record<
    string,
    {
      readonly name?: string;
      readonly if?: string | boolean;
      readonly needs?: unknown;
      readonly "continue-on-error"?: boolean;
      readonly steps: Step[];
    }
  >;
}
const workflow = parse(
  readFileSync(join(root, ".github", "workflows", "mutants.yml"), "utf8"),
) as Workflow;
const job = workflow.jobs.mutants;
const scope = job?.steps.find((step) => step.id === "scope");
const inScope = "steps.scope.outputs.run == 'true'";
const scriptsDir = join(root, "packages", "ichnaea", "scripts");
const mutantScripts = readdirSync(scriptsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => readdirSync(join(scriptsDir, d.name)).includes("mutants.ts"))
  .map((d) => `scripts/${d.name}/mutants.ts`)
  .toSorted();

describe("the mutants workflow", () => {
  it("always schedules the required job and runs every mutation step when in scope", () => {
    expect(mutantScripts).toEqual(
      expect.arrayContaining([
        "scripts/calibration/mutants.ts",
        "scripts/contracts/mutants.ts",
        "scripts/decide/mutants.ts",
        "scripts/stats/mutants.ts",
      ]),
    );
    expect(job).toMatchObject({ name: "mutants" });
    expect(job?.if).toBeUndefined();
    expect(job?.needs).toBeUndefined();
    expect(job?.["continue-on-error"] ?? false).toBe(false);
    expect(scope?.if).toBeUndefined();
    expect(scope?.env).toEqual({
      EVENT: "${{ github.event_name }}",
      BASE: "${{ github.event.pull_request.base.sha }}",
      HEAD: "${{ github.event.pull_request.head.sha }}",
    });
    const steps = job?.steps.filter((step) => step.run?.endsWith("/mutants.ts")) ?? [];
    expect(steps.map((step) => step.run).toSorted()).toEqual(
      mutantScripts.map((script) => `node ${script}`),
    );
    expect(steps.length).toBeGreaterThan(0);
    for (const [i, step] of steps.entries()) {
      expect(step["working-directory"]).toBe("packages/ichnaea");
      expect(step["continue-on-error"] ?? false).toBe(false);
      expect(step.if).toBe(i === 0 ? inScope : `${"${{"} !cancelled() && ${inScope} }}`);
    }
  });

  it("runs on every pull request, on main and nightly, with no path filter", () => {
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(["pull_request", "push", "schedule"]),
    );
    expect(workflow.on["pull_request"]).toBeNull();
    expect(workflow.on["push"]).toEqual({ branches: ["main"] });
  });

  it.each([
    ["pull_request", "packages/ichnaea/src", true],
    ["pull_request", "packages/ichnaea/test", true],
    ...mutantScripts.map(
      (script) => ["pull_request", dirname(`packages/ichnaea/${script}`), true] as const,
    ),
    ["pull_request", "docs", false],
    ["push", "docs", true],
  ] as const)("sets run for %s changes in %s to %s", (event, path, run) => {
    const command = scope?.run;
    if (!command) throw new Error("the required mutants job has no scope step");
    const cwd = mkdtempSync(join(tmpdir(), "ichnaea-mutation-scope-"));
    const git = (...args: string[]): string =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Synthetic",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd, encoding: "utf8" },
      ).trim();
    try {
      git("init", "--quiet");
      git("commit", "--quiet", "--allow-empty", "-m", "base");
      const base = git("rev-parse", "HEAD");
      mkdirSync(join(cwd, path), { recursive: true });
      writeFileSync(join(cwd, path, "scope-case.txt"), "A synthetic change.\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "head");
      const head = git("rev-parse", "HEAD");
      const output = join(cwd, "step-output");
      execFileSync("bash", ["-eo", "pipefail", "-c", command], {
        cwd,
        env: { ...process.env, EVENT: event, BASE: base, HEAD: head, GITHUB_OUTPUT: output },
      });
      expect(readFileSync(output, "utf8")).toBe(`run=${run}\n`);
    } finally {
      rmSync(cwd, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
