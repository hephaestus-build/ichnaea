import { StoreError } from "./store-path.js";
/** Checks the run’s binding between the judge identity and the measure it computed. */
export function verifyRatingJudge(run, judge) {
    if (!run.lineage.some((item) => item.kind === "judge" &&
        item.id === judge.id &&
        item.digest === judge.digest &&
        item.judgedMeasures?.some((measure) => measure.id === judge.measure && measure.version === judge.version)))
        throw new StoreError("the registered judge and measure do not match the recorded judge lineage");
}
/** Reconstructs the calibrated input from the sidecar's canonical human values. */
export function calibrationInput(record) {
    const { scale, values, raters } = record;
    const levels = new Map(scale.map((rating, index) => [String(rating), index + 1]));
    if (levels.size !== scale.length)
        throw new StoreError("the registered scale repeats a level");
    const [first, second] = raters;
    if (raters.length !== 2 || !first || !second)
        throw new StoreError("the study needs two rater slots");
    if (first.measure === second.measure)
        throw new StoreError("rater slots need distinct measures");
    const byTrial = new Map();
    for (const value of values) {
        const row = byTrial.get(value.trial) ?? new Map();
        if (row.has(value.measure))
            throw new StoreError("a trial repeats a rater value");
        if (value.dataClass !== record.dataClass)
            throw new StoreError("a rating has the wrong data class");
        row.set(value.measure, value);
        byTrial.set(value.trial, row);
    }
    const units = record.units.map(({ trial, judge, item, stratum, configuration }) => {
        const row = byTrial.get(trial);
        if (row?.size !== 2)
            throw new StoreError("each trial needs exactly two canonical rater values");
        byTrial.delete(trial);
        const level = (slot) => {
            const value = row.get(slot.measure);
            const score = value && levels.get(value.value.level);
            if (value?.version !== slot.version || score === undefined)
                throw new StoreError("a canonical rating disagrees with its registered slot or scale");
            return score;
        };
        const judgeLevel = levels.get(judge);
        if (judgeLevel === undefined)
            throw new StoreError("a judge level is outside the registered scale");
        return {
            item,
            stratum,
            configuration,
            weight: 1,
            judge: judgeLevel,
            raters: [level(first), level(second)],
        };
    });
    if (byTrial.size > 0)
        throw new StoreError("some canonical ratings lack a calibration unit");
    return { scale: "levels", levels: scale.length, units };
}
//# sourceMappingURL=ratings-calibration.js.map