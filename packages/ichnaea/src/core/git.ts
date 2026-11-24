import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface GitResult {
  readonly stdout: string;
  readonly status: number;
}

export async function git(cwd: string, args: readonly string[]): Promise<GitResult> {
  const { stdout, status } = await gitBytes(cwd, args);
  return { stdout: stdout.toString("utf8"), status };
}

export async function gitBytes(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: Buffer; status: number }> {
  try {
    const result = await execute("git", ["--literal-pathspecs", ...args], {
      cwd,
      encoding: "buffer",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, status: 0 };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number"
    )
      return { stdout: Buffer.alloc(0), status: error.code };
    throw new Error(`git ${args[0]} could not run in the checkout`, { cause: error });
  }
}
