import { canonicalize } from "../contracts/canonical.js";
import { pairFirst } from "../contracts/block-order.js";
function refused(reason, detail) {
    return { status: "refused", reason, detail };
}
function pairKey(pair) {
    return canonicalize([pair.case, pair.replicate]);
}
function assignments(plan, blocks) {
    const arms = new Map(plan.arms.map((arm) => [arm.role, arm.name]));
    const base = arms.get("base");
    const candidate = arms.get("candidate");
    if (base === undefined || candidate === undefined)
        return undefined;
    const complete = new Map(blocks.map((block) => [block.plannedBlock, block]));
    const slots = new Map();
    for (const slot of plan.trials) {
        const key = canonicalize([slot.case, slot.replicate, slot.arm]);
        if (slots.has(key))
            return undefined;
        slots.set(key, slot);
    }
    const draws = new Map(blocks.map((block) => [
        block.block,
        new Map(block.draws?.map((draw, index) => [pairKey(draw), { ...draw, index }])),
    ]));
    const result = [];
    for (const b of plan.trials) {
        if (b.arm !== base || b.block === undefined)
            continue;
        const execution = complete.get(b.block);
        if (!execution)
            continue;
        const c = slots.get(canonicalize([b.case, b.replicate, candidate]));
        const draw = draws.get(execution.block)?.get(pairKey(b));
        if (!c ||
            c.block !== b.block ||
            !draw ||
            draw.first !== pairFirst(plan.seed, execution.block, b))
            return undefined;
        result.push({
            case: b.case,
            block: execution.block,
            base: b,
            candidate: c,
            first: draw.first,
            drawIndex: draw.index,
        });
    }
    const expected = (plan.analysis?.cases.length ?? 0) * (plan.analysis?.replicates ?? 0);
    if (expected === 0 ||
        result.length !== expected * blocks.length ||
        blocks.some((block) => block.draws?.length !== expected || draws.get(block.block)?.size !== expected))
        return undefined;
    return result;
}
function contextGroups(blocks, trials) {
    const roots = new Map(blocks.map(({ block }) => [block, block]));
    const first = new Map();
    const root = (block) => {
        let current = block;
        while (roots.get(current) !== current)
            current = roots.get(current);
        return current;
    };
    for (const trial of trials) {
        if (trial.block === undefined || trial.context === undefined || !roots.has(trial.block))
            continue;
        const earlier = first.get(trial.context);
        if (earlier === undefined)
            first.set(trial.context, trial.block);
        else
            roots.set(root(trial.block), root(earlier));
    }
    return new Map(blocks.map(({ block }) => [block, root(block)]));
}
/** Admit only the locked pair draws of completed blocks and verify their recorded start ranks. */
export function admitBlocks(plan, run, trials) {
    const execution = run.execution;
    if (!plan.analysis || !execution || execution.source !== "runner")
        return refused("ESTIMATE_ONLY_EXPLORATORY", "the runner did not record randomized assignments");
    if (plan.analysis.method !== "binary-randomized-blocks")
        return refused("ESTIMATE_ONLY_NO_METHOD", "the locked analysis has no randomized decision method");
    if (!execution.blocks ||
        trials.some((trial) => trial.startedAt === undefined ||
            trial.endedAt === undefined ||
            trial.block === undefined ||
            !trial.context ||
            trial.analysisPlan === undefined ||
            Date.parse(trial.endedAt) < Date.parse(trial.startedAt)))
        return refused("EXECUTION_UNRECORDED", "an execution block, context or timestamp is missing");
    if (run.exploratory)
        return refused("ESTIMATE_ONLY_EXPLORATORY", "the runner did not record a verified draw for each case pair");
    if (!execution.seed || canonicalize(execution.seed) !== canonicalize(plan.seed))
        return refused("ESTIMATE_ONLY_EXPLORATORY", "the runner did not record the plan seed");
    const completed = execution.blocks.filter((block) => block.status === "complete");
    if (new Set(completed.map((block) => block.plannedBlock)).size !== completed.length ||
        new Set(execution.blocks.map((block) => block.block)).size !== execution.blocks.length ||
        completed.some((block) => block.plannedBlock >= plan.analysis.blocks))
        return refused("EXECUTION_UNRECORDED", "completed blocks do not match the locked horizon");
    const pairs = assignments(plan, completed);
    if (!pairs)
        return refused("ESTIMATE_ONLY_EXPLORATORY", "the recorded order does not match the seeded pair draws");
    const byTrial = new Map(trials.map((trial) => [trial.id, trial]));
    // Timestamps can tie when dispatch fills multiple worker slots in the same clock tick.
    // The execution receipt lists each block's draws in dispatch order.
    const dispatchRanks = new Map();
    for (const pair of pairs.toSorted((a, b) => a.block - b.block || a.drawIndex - b.drawIndex)) {
        const [first, second] = pair.first === "base" ? [pair.base, pair.candidate] : [pair.candidate, pair.base];
        dispatchRanks.set(first.id, dispatchRanks.size);
        dispatchRanks.set(second.id, dispatchRanks.size);
    }
    // A retry replaces the outcome at the assigned dispatch position. The earlier attempt does
    // not carry a timestamp in old records. Fill its outcome against the claim.
    const retried = new Set(trials.filter((trial) => trial.attempts?.length).map(({ id }) => id));
    const ranks = new Map(trials
        .filter((trial) => !retried.has(trial.id) && dispatchRanks.has(trial.id))
        .toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
        dispatchRanks.get(a.id) - dispatchRanks.get(b.id))
        .map((trial, rank) => [trial.id, rank]));
    const excluded = new Set(retried);
    const owners = new Map();
    for (const trial of trials)
        for (const id of trial.responseIds ?? []) {
            const before = owners.get(id);
            if (before !== undefined && before !== trial.id) {
                excluded.add(before);
                excluded.add(trial.id);
            }
            owners.set(id, trial.id);
        }
    const limit = 2 * (plan.schedule?.concurrency ?? 1) - 1;
    for (const pair of pairs) {
        const base = byTrial.get(pair.base.id);
        const candidate = byTrial.get(pair.candidate.id);
        for (const trial of [base, candidate]) {
            if (trial &&
                (trial.block !== pair.block ||
                    trial.first !== pair.first ||
                    canonicalize(trial.armOrderSeed ?? null) !== canonicalize(plan.seed)))
                return refused("ESTIMATE_ONLY_EXPLORATORY", "a trial contradicts its recorded pair draw");
            if (trial?.cache?.hit)
                excluded.add(trial.id);
        }
        if (!base || !candidate || retried.has(base.id) || retried.has(candidate.id))
            continue;
        const first = pair.first === "base" ? base : candidate;
        const second = first === base ? candidate : base;
        if (Date.parse(first.startedAt) > Date.parse(second.startedAt) ||
            Math.abs(ranks.get(first.id) - ranks.get(second.id)) > limit)
            return refused("ARMS_NOT_INTERLEAVED", "a pair ran out of order or too far apart in start rank");
    }
    const groups = contextGroups(completed, trials);
    return {
        status: "admitted",
        planned: plan.analysis.blocks,
        observed: completed.length,
        effective: new Set(groups.values()).size,
        pairs: pairs.map((pair) => ({
            case: pair.case,
            block: pair.block,
            group: groups.get(pair.block),
            base: pair.base.id,
            candidate: pair.candidate.id,
        })),
        excluded,
    };
}
//# sourceMappingURL=blocks.js.map