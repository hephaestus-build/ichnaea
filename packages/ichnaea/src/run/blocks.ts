import { type PairDraw, pairFirst } from "../contracts/block-order.ts";
import { canonicalize, digest } from "../contracts/canonical.ts";
import { Plan } from "../contracts/records/plan.ts";
import type { TrialIdentity, TrialResult } from "../contracts/records/worker.ts";

import { type Capture, captureStatus } from "./capture.ts";

type Slot = Plan["trials"][number];

export interface RunnerOptions {
  readonly capacity: number;
  readonly deadlineMs: number;
  readonly maxAttempts: number;
}

interface Block {
  readonly block: number;
  readonly plannedBlock: number;
  readonly draws: readonly PairDraw[];
}

interface ClosedBlock extends Block {
  readonly status: "complete" | "abandoned";
}

interface RecoveredBlock extends ClosedBlock {
  readonly calls: number;
}

export interface Attempt {
  readonly trial: TrialIdentity;
  readonly block: number;
  readonly first?: PairDraw["first"];
  readonly started: number;
  readonly deadline: number;
  readonly calls: number;
}

interface Settlement {
  readonly attempt: Attempt;
  readonly calls: number;
  readonly disposition: "record" | "retry" | "timeout" | "protocol" | "budget-exceeded";
}

type Result = Pick<TrialResult, "trial" | "usage" | "failure"> & Capture;

interface Progress {
  readonly slot: Slot;
  readonly first?: PairDraw["first"];
  attempt: number;
  calls: number;
  last?: Settlement["disposition"];
}

interface Active {
  readonly block: Block;
  readonly reserved: number;
  readonly pending: Progress[];
  readonly progress: ReadonlyMap<string, Progress>;
  readonly flight: Map<string, Attempt>;
  calls: number;
}

function count(value: number, what: string, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`invalid ${what}`);
}

function time(value: number): void {
  if (!Number.isFinite(value)) throw new Error("invalid clock reading");
}

function slotsByBlock(plan: Plan): readonly (readonly Slot[])[] {
  const analysis = plan.analysis;
  if (!analysis) throw new Error("the runner needs a locked analysis plan");
  const known = new Set(analysis.cases.map(({ id }) => id));
  const seen = new Set<string>();
  const armNames = new Set(plan.arms.map(({ name }) => name));
  if (
    known.size !== analysis.cases.length ||
    armNames.size !== plan.arms.length ||
    plan.arms.filter(({ role }) => role === "base").length !== 1 ||
    plan.arms.filter(({ role }) => role === "candidate").length !== plan.arms.length - 1 ||
    plan.arms.length > 2
  )
    throw new Error("the locked plan needs unique cases and one base with at most one candidate");

  const perBlock = analysis.cases.length * analysis.replicates * plan.arms.length;
  if (plan.trials.length !== analysis.blocks * perBlock)
    throw new Error("the locked plan has the wrong trial horizon");
  const groups = Array.from({ length: analysis.blocks }, () => new Map<string, Slot>());
  for (const slot of plan.trials) {
    const group = slot.block === undefined ? undefined : groups[slot.block];
    if (!group || !known.has(slot.case) || !armNames.has(slot.arm) || seen.has(slot.id))
      throw new Error(`unknown or duplicate planned trial '${slot.id}'`);
    seen.add(slot.id);
    const key = canonicalize([slot.case, slot.replicate, slot.arm]);
    if (group.has(key)) throw new Error(`duplicate case, replicate and arm for '${slot.id}'`);
    group.set(key, slot);
  }
  return groups.map((group, block) => {
    if (group.size !== perBlock) throw new Error(`planned block ${block} has the wrong horizon`);
    return analysis.cases.flatMap(({ id }) =>
      Array.from({ length: analysis.replicates }, (_, offset) =>
        plan.arms.map(({ name }) => {
          const replicate = block * analysis.replicates + offset;
          const trial = group.get(canonicalize([id, replicate, name]));
          if (!trial) throw new Error(`planned block ${block} misses a trial for '${id}'`);
          return trial;
        }),
      ).flat(),
    );
  });
}

export class InsufficientCallBudget extends Error {}

/** Schedules an already bound analysis. The caller supplies the clock and transports attempts. */
export class BlockRunner {
  readonly planDigest: string;
  readonly #plan: Plan;
  readonly #options: RunnerOptions;
  readonly #slots: readonly (readonly Slot[])[];
  readonly #callsPerTrial: number;
  readonly #cap: number;
  #active: Active | undefined;
  #nextBlock = 0;
  #plannedBlock = 0;
  #spent = 0;
  #halt: string | undefined;

  constructor(plan: Plan, options: RunnerOptions, history: readonly RecoveredBlock[] = []) {
    count(options.capacity, "worker capacity");
    count(options.maxAttempts, "retry horizon");
    if (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)
      throw new Error("invalid trial deadline");
    this.#plan = Plan.parse(plan);
    this.#slots = slotsByBlock(this.#plan);
    this.#options = {
      ...options,
      capacity: Math.min(options.capacity, plan.schedule?.concurrency ?? options.capacity),
    };
    this.#callsPerTrial = plan.budget.callsPerTrial ?? 1;
    count(this.#callsPerTrial, "per-trial call bound");
    this.#cap = Math.min(
      plan.budget.maxCalls,
      plan.analysis?.maxCalls ?? 0,
      plan.budget.monthlyRemaining ?? Infinity,
    );
    count(this.#cap, "run budget", 0);
    if (this.#callsPerTrial * plan.trials.length > this.#cap)
      throw new Error("the planned attempts exceed the run budget");
    this.planDigest = digest(this.#plan);
    for (const block of history) {
      const slots = this.#slots[this.#plannedBlock];
      if (
        !slots ||
        block.block !== this.#nextBlock ||
        block.plannedBlock !== this.#plannedBlock ||
        canonicalize(block.draws) !== canonicalize(this.#order(slots, block.block).draws)
      )
        throw new Error("the run journal does not match the planned block order");
      count(block.calls, "journal call count", 0);
      const reserved = slots.length * this.#callsPerTrial;
      this.#nextBlock++;
      if (block.status === "complete") {
        if (block.calls > reserved)
          throw new Error("the run journal completed an over-budget block");
        this.#spent += block.calls;
        this.#plannedBlock++;
      } else this.#spent += Math.max(reserved, block.calls);
    }
    if (this.#spent > this.#cap) this.#halt = "the run exceeded its call budget";
  }

  get stopped(): boolean {
    return this.#halt !== undefined;
  }

  get calls(): number {
    return this.#spent + (this.#active?.calls ?? 0);
  }

  #order(slots: readonly Slot[], block: number): { draws: PairDraw[]; pending: Progress[] } {
    const draws: PairDraw[] = [];
    const pending: Progress[] = [];
    const [firstArm] = this.#plan.arms;
    const width = this.#plan.arms.length;
    for (let index = 0; index < slots.length; index += width) {
      const a = slots[index];
      if (!a) throw new Error("missing trial at the start of a pair");
      if (width === 1) {
        pending.push({ slot: a, attempt: 0, calls: 0 });
        continue;
      }
      const b = slots[index + 1];
      if (!b) throw new Error("missing trial at the end of a pair");
      const first = pairFirst(this.#plan.seed, block, a);
      draws.push({ case: a.case, replicate: a.replicate, first });
      for (const slot of firstArm?.role === first ? [a, b] : [b, a])
        pending.push({ slot, first, attempt: 0, calls: 0 });
    }
    return { draws, pending };
  }

  startBlock(): Block | undefined {
    if (this.#halt) throw new Error(this.#halt);
    if (this.#active) throw new Error("finish or abandon the active block first");
    const slots = this.#slots[this.#plannedBlock];
    if (!slots) return undefined;
    const reserved = slots.length * this.#callsPerTrial;
    const remaining = this.#slots.length - this.#plannedBlock;
    if (this.#spent + remaining * reserved > this.#cap)
      throw new InsufficientCallBudget("insufficient call budget to finish the planned blocks");
    const { draws, pending } = this.#order(slots, this.#nextBlock);
    const block: Block = { block: this.#nextBlock++, plannedBlock: this.#plannedBlock, draws };
    this.#active = {
      block,
      reserved,
      pending,
      progress: new Map(pending.map((p) => [p.slot.id, p])),
      flight: new Map(),
      calls: 0,
    };
    return { ...block, draws: draws.map((draw) => ({ ...draw })) };
  }

  dispatch(now: number, capacity: number = this.#options.capacity): Attempt | undefined {
    time(now);
    const active = this.#active;
    if (this.#halt || !active || active.flight.size >= Math.min(capacity, this.#options.capacity))
      return undefined;
    if ([...active.flight.values()].some(({ deadline }) => now >= deadline)) return undefined;
    const next = active.pending.shift();
    if (!next) return undefined;
    const { id, case: caseId, arm, replicate } = next.slot;
    const deadline = now + this.#options.deadlineMs;
    time(deadline);
    const attempt: Attempt = {
      trial: { id, case: caseId, arm, replicate, suite: this.#plan.suite, attempt: ++next.attempt },
      block: active.block.block,
      ...(next.first === undefined ? {} : { first: next.first }),
      started: now,
      deadline,
      calls: this.#callsPerTrial - next.calls,
    };
    active.flight.set(id, attempt);
    return { ...attempt, trial: { ...attempt.trial } };
  }

  accept(block: number, result: Result, now: number): Settlement {
    time(now);
    const active = this.#active;
    if (block !== active?.block.block)
      throw new Error(
        block < this.#nextBlock
          ? "late result for a closed block"
          : "result names an unknown block",
      );
    const id = result.trial.id;
    const attempt = active.flight.get(id);
    const progress = active.progress.get(id);
    if (!progress || progress.attempt === 0) throw new Error("result names an unknown attempt");
    if (result.trial.attempt < progress.attempt || progress.last === "timeout")
      throw new Error("late result for a finished attempt");
    if (result.trial.attempt > progress.attempt) throw new Error("result names an unknown attempt");
    if (!attempt)
      throw new Error(
        progress.last === "retry" ? "late result for a finished attempt" : "duplicate result",
      );
    if (canonicalize(attempt.trial) !== canonicalize(result.trial))
      throw new Error("result does not match the attempt identity");
    if (now < attempt.started || now >= attempt.deadline)
      throw new Error("late result or invalid result time");
    const calls = result.usage.calls;
    count(calls, "result call count", 0);
    if (calls > attempt.calls) {
      this.#halt = "the worker exceeded the attempt call bound";
      return this.#settle(active, attempt, progress, calls, "budget-exceeded");
    }
    const cause = result.failure?.class;
    if (cause === "protocol") {
      this.#halt = "the worker failed the protocol";
      return this.#settle(active, attempt, progress, calls, "protocol");
    }
    const retry =
      (cause === "infrastructure" ||
        cause === "not_run" ||
        (cause === undefined && captureStatus(result) === "not-captured")) &&
      progress.attempt < this.#options.maxAttempts &&
      calls < attempt.calls;
    return this.#settle(active, attempt, progress, calls, retry ? "retry" : "record");
  }

  expire(now: number): readonly Settlement[] {
    time(now);
    const active = this.#active;
    if (!active) return [];
    const timedOut: Settlement[] = [];
    for (const attempt of active.flight.values()) {
      if (now < attempt.deadline) continue;
      const progress = active.progress.get(attempt.trial.id);
      if (!progress) throw new Error("the active attempt has no planned slot");
      timedOut.push(this.#settle(active, attempt, progress, attempt.calls, "timeout"));
    }
    return timedOut;
  }

  #settle(
    active: Active,
    attempt: Attempt,
    progress: Progress,
    calls: number,
    disposition: Settlement["disposition"],
  ): Settlement {
    active.flight.delete(attempt.trial.id);
    progress.calls += calls;
    progress.last = disposition;
    active.calls += calls;
    if (disposition === "retry") active.pending.unshift(progress);
    return { attempt, calls, disposition };
  }

  finishBlock(): ClosedBlock {
    const active = this.#active;
    if (this.#halt || !active || active.pending.length > 0 || active.flight.size > 0)
      throw new Error("a block can finish only when its planned attempts are settled");
    this.#spent += active.calls;
    this.#plannedBlock++;
    this.#active = undefined;
    return { ...active.block, status: "complete" };
  }

  abandonBlock(reason?: "transport"): ClosedBlock {
    const active = this.#active;
    if (!active) throw new Error("there is no active block");
    if (!reason && !this.#halt && active.pending.length === 0 && active.flight.size === 0)
      throw new Error("a settled block must be completed");
    this.#spent += Math.max(active.reserved, active.calls);
    this.#active = undefined;
    return { ...active.block, status: "abandoned" };
  }
}
