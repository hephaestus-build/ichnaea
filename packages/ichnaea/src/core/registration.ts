import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import * as z from "zod";

import { type PairDraw, PairDrawRecord, pairFirst } from "../contracts/block-order.ts";
import { AnalysisPlan } from "../contracts/records/analysis-plan.ts";
import { Digest, RunId, Seed, Timestamp } from "../contracts/primitives.ts";

import { git, gitBytes } from "./git.ts";

const commitId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const binding = {
  run: RunId,
  base: Digest,
  candidate: Digest.optional(),
  seed: Seed,
  at: Timestamp,
};

export interface RegistrationReceipt {
  readonly run: string;
  readonly base: string;
  readonly candidate?: string | undefined;
  readonly seed: z.infer<typeof Seed>;
  readonly at: string;
  readonly planPath: string;
  readonly planCommit: string;
  readonly planFileDigest: string;
  readonly remote: string;
  readonly ref: string;
  readonly remoteSha: string;
  readonly draws?:
    | readonly { readonly block: number; readonly pairs: readonly PairDraw[] }[]
    | undefined;
}

/** The receipt written before dispatch, bound to the arms and seed at run start. */
export const RegistrationReceiptSchema: z.ZodType<RegistrationReceipt> = z.strictObject({
  ...binding,
  planPath: z.string().min(1),
  planCommit: commitId,
  planFileDigest: Digest,
  remote: z.string().min(1),
  ref: z.string().startsWith("refs/"),
  remoteSha: commitId,
  draws: z
    .array(
      z.strictObject({
        block: z.int().nonnegative(),
        pairs: z.array(PairDrawRecord),
      }),
    )
    .optional(),
});

export type RegistrationLabel = "registered" | "unregistered" | "exploratory";

export function registrationLabel(
  source: "runner" | "import" | "re-score",
  randomized: boolean,
  receipt?: RegistrationReceipt,
): RegistrationLabel {
  if (source !== "runner" || !randomized) return "exploratory";
  return receipt === undefined ? "unregistered" : "registered";
}

/** Git treats a shallow boundary like a root, so log can attribute unchanged files to it. */
async function hasVisibleChange(root: string, revision: string): Promise<boolean> {
  const parents = await git(root, ["rev-list", "--parents", "--max-count=1", revision]);
  if (parents.status !== 0) return false;
  if (parents.stdout.trim().includes(" ")) return true;
  const raw = await git(root, ["cat-file", "commit", revision]);
  const header = raw.stdout.split("\n\n", 1)[0] ?? "";
  return raw.status === 0 && !/^parent /m.test(header);
}

function plannedDraws(
  bytes: Buffer,
  seed: RegistrationReceipt["seed"],
): RegistrationReceipt["draws"] {
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  const parsed = AnalysisPlan.safeParse(input);
  if (!parsed.success) return undefined;
  const { blocks, cases, replicates } = parsed.data;
  return Array.from({ length: blocks }, (_, block) => ({
    block,
    pairs: cases.flatMap(({ id }) =>
      Array.from({ length: replicates }, (_replicate, offset) => {
        const pair = { case: id, replicate: block * replicates + offset };
        return { ...pair, first: pairFirst(seed, block, pair) };
      }),
    ),
  }));
}

export async function anchorAnalysisPlan(
  cwd: string,
  plan: string,
  anchor: string,
  arms: Pick<RegistrationReceipt, "run" | "base" | "candidate" | "seed" | "at">,
): Promise<RegistrationReceipt | undefined> {
  const split = anchor.indexOf("/");
  const remote = anchor.slice(0, split);
  const branch = anchor.slice(split + 1);
  if (split < 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote) || !branch)
    throw new Error("anchor must name a Git remote and branch, such as origin/main");
  const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  if ((await git(cwd, ["check-ref-format", ref])).status !== 0)
    throw new Error("anchor has an invalid Git ref");
  if ((await git(cwd, ["remote", "get-url", remote])).status !== 0)
    throw new Error("anchor must name a configured Git remote");

  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new Error("analysis plan must be in a Git checkout");
  const root = await realpath(top.stdout.trimEnd());
  const path = await realpath(resolve(cwd, plan));
  const local = relative(root, path);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error("analysis plan must be inside the Git checkout");
  const planPath = local.split(sep).join("/");
  const revision = await git(root, ["log", "-1", "--format=%H", "HEAD", "--", planPath]);
  if (revision.status !== 0) return undefined;
  const planCommit = commitId.safeParse(revision.stdout.trim());
  if (!planCommit.success || !(await hasVisibleChange(root, planCommit.data))) return undefined;
  const committed = await gitBytes(root, ["show", `${planCommit.data}:${planPath}`]);
  if (committed.status !== 0 || !committed.stdout.equals(await readFile(path))) return undefined;

  const remoteRef = await git(root, ["ls-remote", "--exit-code", "--refs", "--", remote, ref]);
  if (remoteRef.status === 2) return undefined;
  if (remoteRef.status !== 0) throw new Error("git ls-remote could not read the anchor ref");
  const [sha, reportedRef, ...extra] = remoteRef.stdout.trimEnd().split(/[\t\n]/);
  if (reportedRef !== ref || extra.length > 0)
    throw new Error("git ls-remote returned an unexpected ref");
  const remoteSha = commitId.parse(sha);
  // The checkout supplies ancestry. A shallow clone can fetch the anchor history before running.
  if ((await git(root, ["merge-base", "--is-ancestor", planCommit.data, remoteSha])).status !== 0)
    return undefined;

  const { candidate, ...required } = arms;
  const draws = candidate === undefined ? undefined : plannedDraws(committed.stdout, arms.seed);
  return RegistrationReceiptSchema.parse({
    ...required,
    ...(candidate === undefined ? {} : { candidate }),
    ...(draws === undefined ? {} : { draws }),
    planPath,
    planCommit: planCommit.data,
    planFileDigest: `sha256:${createHash("sha256").update(committed.stdout).digest("hex")}`,
    remote,
    ref,
    remoteSha,
  });
}
