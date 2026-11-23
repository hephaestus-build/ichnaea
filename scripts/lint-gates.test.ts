import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..");
const recordPath = "packages/ichnaea/src/contracts/records/trial.ts";
const registryPath = "packages/ichnaea/src/contracts/registry.ts";
const majorsPath = "packages/ichnaea/majors.json";

function scratch(use: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ichnaea-lint-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    use(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

function gate(root: string, script: string, scriptRoot = repo) {
  return spawnSync(process.execPath, [join(scriptRoot, "scripts", script)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ICHNAEA_CONTRACT_BASE: "HEAD" },
  });
}

describe("framework purity", () => {
  it.each([
    'export const admit = (event: string): boolean => event === "pull_request_review.submitted";',
    'export const admit = (event: string) => event === "issues.opened";',
    'export const admit = (payload: { event?: string }) => payload.event === "issues.opened";',
    'export const admit = (payload?: { event: string }) => payload?.event === "issues.opened";',
    'export const admit = (payload: string) => JSON.parse(payload).event === "issues.opened";',
    'const allowed = new Set(["pull_request.opened"]); export const admit = (event: string) => allowed.has(event);',
    'export const admit = (event: { name: string; action: string }) => event.name === "pull_request" && event.action === "opened";',
  ])("refuses raw event admission rule %s", (source) => {
    scratch((root) => {
      const path = "packages/ichnaea/scripts/admit.ts";
      write(root, path, source);
      const result = gate(root, "check-purity.ts");
      expect(result.status, result.stderr + result.stdout).toBe(1);
      expect(result.stderr).toContain(path);
    });
  });

  it("resolves a payload type declared in another module", () => {
    scratch((root) => {
      const path = "packages/ichnaea/scripts/admit.ts";
      write(root, "packages/ichnaea/scripts/payload.ts", "export type Raw = { event?: string };");
      write(
        root,
        path,
        'import type { Raw } from "./payload.ts"; export const admit = (p: Raw) => p.event === "issues.opened";',
      );
      const result = gate(root, "check-purity.ts");
      expect(result.status, result.stderr + result.stdout).toBe(1);
      expect(result.stderr).toContain(path);
    });
  });

  it("allows typed framework events and file names", () => {
    scratch((root) => {
      write(root, "packages/ichnaea/fixture/suite_lock.json", "{}");
      write(
        root,
        "packages/ichnaea/scripts/payload.ts",
        'export type Event = "tool_call.started" | "tool_call.finished";',
      );
      write(
        root,
        "packages/ichnaea/scripts/admit.ts",
        `
import type { Event } from "./payload.ts";
export const started = (event?: Event) => event === "tool_call.started";
export const isLock = (file: string) => file === "suite_lock.json";
`,
      );
      const result = gate(root, "check-purity.ts");
      expect(result.status, result.stderr + result.stdout).toBe(0);
    });
  });

  it("refuses an import that resolves to an application, through a TypeScript path alias", () => {
    scratch((root) => {
      write(
        root,
        "packages/ichnaea/tsconfig.json",
        JSON.stringify({
          compilerOptions: { paths: { "#target": ["../../examples/target/adapter.ts"] } },
        }),
      );
      write(root, "examples/target/adapter.ts", "export const run = true;\n");
      const path = "packages/ichnaea/scripts/admit.ts";
      write(root, path, 'export { run } from "#target";\n');
      const result = gate(root, "check-purity.ts");
      expect(result.status, result.stderr + result.stdout).toBe(1);
      expect(result.stderr).toContain(path);
    });
  });
});

function contractScratch(use: (root: string) => void): void {
  scratch((root) => {
    for (const path of [
      "scripts",
      "packages/ichnaea/src/contracts",
      "packages/ichnaea/fixtures",
      majorsPath,
      "packages/ichnaea/package.json",
      "packages/ichnaea/README.md",
      "package.json",
    ]) {
      cpSync(join(repo, path), join(root, path), { recursive: true });
    }
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Synthetic",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "baseline",
      ],
      { cwd: root },
    );
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "junction");
    symlinkSync(
      join(repo, "packages/ichnaea/node_modules"),
      join(root, "packages/ichnaea/node_modules"),
      "junction",
    );
    use(root);
  });
}

describe("contract major compatibility", () => {
  it("refuses a same-major reader that now requires an extra field", () => {
    contractScratch((root) => {
      const prior = readFileSync(join(root, recordPath), "utf8");
      const changed = prior.replace(
        "export const Trial = z.strictObject({",
        "$&\n  auditRequired: z.string(),",
      );
      expect(changed).not.toBe(prior);
      write(root, recordPath, changed);
      const result = gate(root, "check-contract-majors.ts", root);
      expect(result.status, result.stderr + result.stdout).toBe(1);
      expect(result.stderr).toContain("trial");
      expect(result.stderr).toContain("auditRequired");
    });
  });

  it.each([
    ["trial", "README.md", undefined, 1],
    ["trial", "migration.ts", "export const migrate = () => ({ schema: 'ichnaea.trial/2' });", 1],
    [
      "trialResult",
      "migration.ts",
      "export const migrate = (record: object) => ({ ...record, schema: 'ichnaea.trialResult/2' });",
      0,
    ],
  ] as const)(
    "checks the %s migration at %s against previous records",
    (kind, path, source, exit) => {
      contractScratch((root) => {
        const recordFile =
          kind === "trial" ? recordPath : recordPath.replace(/trial\.ts$/, "worker.ts");
        for (const schemaPath of [recordFile, registryPath]) {
          write(
            root,
            schemaPath,
            readFileSync(join(root, schemaPath), "utf8").replaceAll(
              `ichnaea.${kind}/1`,
              `ichnaea.${kind}/2`,
            ),
          );
        }
        const majors = JSON.parse(readFileSync(join(root, majorsPath), "utf8")) as {
          records: Record<typeof kind, Record<string, string | null>>;
        };
        majors.records[kind]["2"] = path;
        write(root, majorsPath, JSON.stringify(majors));
        if (source) write(root, `packages/ichnaea/${path}`, source);
        const result = gate(root, "check-contract-majors.ts", root);
        expect(result.status, result.stderr + result.stdout).toBe(exit);
        if (exit && !source) expect(result.stderr).toContain(path);
        else if (exit) expect(result.stderr).toContain("fixtures/valid/trial.json");
      });
    },
  );
});
