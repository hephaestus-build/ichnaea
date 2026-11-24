function state(entry) {
    if (entry.hit)
        return "hit";
    return entry.planned > 0 && entry.observed === entry.planned ? "clean" : "missing";
}
function blockWindows(trials) {
    const windows = new Map();
    for (const trial of trials) {
        const { block, startedAt, endedAt } = trial;
        if (block === undefined ||
            startedAt === undefined ||
            endedAt === undefined ||
            Date.parse(startedAt) > Date.parse(endedAt))
            continue;
        const window = windows.get(block);
        if (!window) {
            windows.set(block, { block, startedAt, endedAt });
            continue;
        }
        if (Date.parse(startedAt) < Date.parse(window.startedAt))
            window.startedAt = startedAt;
        if (Date.parse(endedAt) > Date.parse(window.endedAt))
            window.endedAt = endedAt;
    }
    return [...windows.values()].toSorted((a, b) => a.block - b.block);
}
/** Count a case once if any fresh completed trial hit. A partly observed non-hit is missing. */
export function mustNeverCounts(plan, trials, values) {
    if (!plan.analysis?.mustNever || plan.arms.length !== 1)
        return undefined;
    const byTrial = new Map(trials.filter((trial) => !trial.cache?.hit).map((trial) => [trial.id, trial]));
    return plan.analysis.mustNever.map(({ measure, cases, scope, detector }) => {
        const variants = detector.kind === "deterministic" ? detector.variants : [];
        const included = new Set([...cases, ...variants.map(({ positiveControl }) => positiveControl)]);
        const counts = new Map([...included].map((id) => [
            id,
            { planned: 0, observed: 0, hit: false, contexts: new Set() },
        ]));
        const scored = new Map(values
            .filter((value) => value.measure === measure && value.applicable)
            .map((value) => [value.trial, value.value]));
        const execution = [];
        for (const slot of plan.trials) {
            const entry = counts.get(slot.case);
            if (!entry)
                continue;
            entry.planned++;
            const trial = byTrial.get(slot.id);
            if (!trial)
                continue;
            if (trial.context !== undefined)
                entry.contexts.add(trial.context);
            execution.push(trial);
            if (trial.outcome !== "completed" && trial.outcome !== "abstained")
                continue;
            const value = scored.get(slot.id);
            if (value?.type !== "binary")
                continue;
            entry.observed++;
            entry.hit ||= value.pass;
        }
        const rows = cases.map((id) => {
            const entry = counts.get(id);
            return {
                case: id,
                planned: entry.planned,
                observed: entry.observed,
                status: state(entry),
                contexts: [...entry.contexts].toSorted(),
            };
        });
        return {
            measure,
            scope,
            detector: detector.kind,
            planned: rows.length,
            clean: rows.filter((row) => row.status === "clean").length,
            hits: rows.filter((row) => row.status === "hit").length,
            missing: rows.filter((row) => row.status === "missing").length,
            cases: rows,
            windows: blockWindows(execution),
            controls: variants.map(({ pattern, positiveControl }) => ({
                pattern,
                case: positiveControl,
                status: state(counts.get(positiveControl)),
            })),
        };
    });
}
//# sourceMappingURL=must-never.js.map