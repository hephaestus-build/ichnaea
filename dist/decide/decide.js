import { canonicalize, digest } from "../contracts/canonical.js";
import { verifyArms } from "../contracts/identity.js";
import { candidateRunsFirst } from "../contracts/pair-order.js";
import { FactorPart } from "../contracts/records/configuration.js";
import { Decision } from "../contracts/records/decision.js";
import { REFUSED_MARGIN } from "../contracts/records/plan.js";
import { proportionProblem } from "../contracts/values.js";
import { TRIGGER_VARIES } from "../core/planner.js";
import { recordProblems } from "../core/records.js";
import { compareCounts, EstimandError, MARGIN_FLOOR_NOT_SET, } from "../stats/compare.js";
import { holm } from "../stats/multiplicity.js";
import { fixedCasesMde, sampledCasesFloor } from "../stats/power.js";
import { createRng } from "../stats/rng.js";
import { wilson } from "../stats/wilson.js";
import { describeCounts, plannedTrialsPerCase, planningPower } from "./planning.js";
/** Outcomes that leave a planned trial without a value: they are missing, never a failure. */
const MISSING = new Set([
    "infrastructure_failure",
    "not_run",
    "invalid_configuration",
    // The run is INVALID; the trial gives no value, and it is never a failure or a pass.
    "protocol_failure",
]);
/**
 * Outcomes that score as a failed trial on a binary measure whatever value a record carries
 * (REQ-20): the system failed, so the trial cannot pass.
 */
const FAILED = new Set(["system_failure", "budget_exceeded"]);
const DEFAULT_COVERAGE_FLOOR = 0.9;
/**
 * The reason of an INCONCLUSIVE run when the unset validated margin floor alone keeps every primary
 * measure from NON-INFERIOR: each lower bound clears its effective margin, also with the measure's
 * missing trials imputed against non-inferiority (decision 0015). A stable unchanged candidate gets
 * it, so it must not read as a broken setup.
 */
export const FLOOR_NOT_SET_REASON = "No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set.";
/** One measure's cause when the floor alone keeps it from NON-INFERIOR, and others have causes too. */
const FLOOR_CAUSE = "no PASS yet, because the validated margin floor is not set";
/** The statistics package's name for a value type. A type it has no name for has no method. */
const STATS_VALUE_TYPE = {
    binary: "binary",
    proportion: "proportion",
    score: "score",
    level: "ordinal",
};
const NAN = { nonFinite: "nan" };
const NEG_INF = { nonFinite: "-inf" };
const POS_INF = { nonFinite: "inf" };
/** Works against non-inferiority: missing candidate trials fail, missing base trials pass. */
const AGAINST_NON_INFERIORITY = { base: true, candidate: false };
/** Works against regression: missing candidate trials pass, missing base trials fail. */
const AGAINST_REGRESSION = { base: false, candidate: true };
/**
 * The plan's planning statement (REQ-54, decision 0017). A plan made with the decide plugin carries
 * it. A plan that carries none gets it from `planningPower`, the plugin's own function, because the
 * statement is a function of the plan alone. Its `floor` and `decidable` say whether the planning
 * floor is below the margin. It never changes the mode: only the plugin switches a plan to
 * estimate-only, before any call. When `planningPower` gives no statement, each entry says only
 * what `decide` observes: the margin is refused, with `planningPower`'s refusal text, or no
 * statement can be computed from the plan (for example, it plans no trial in the base arm). A plan
 * with a primary measure never gives an empty statement.
 */
function planningOf(plan) {
    if (plan.power.length > 0)
        return plan.power;
    const { power, refuse } = planningPower(plan);
    if (power && power.length > 0)
        return power;
    return plan.primary.map((p) => {
        const common = {
            computed: false,
            measure: p.measure,
            applicableCases: new Set(plan.trials.map((t) => t.case)).size,
            replicates: plan.replicates,
            margin: p.margin,
        };
        return refuse === undefined
            ? {
                ...common,
                reason: "the plan carries no planning statement, and none can be computed from it",
            }
            : { ...common, reason: REFUSED_MARGIN, refusal: refuse };
    });
}
const NO_CASES = new Set();
/** The regression limitation of a run at one trial per case whose records lack a time. */
const NO_TIMES = "the records do not show when the arms ran";
/** The decision's limitation at one trial per case: the pair checks read the recorded times. */
const CLOCK_LIMITATION = "Decide trusts the trial timestamps as recorded. An importer that merges several hosts states its clock source.";
/** Orders strings by UTF-16 code units. */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/**
 * Whether a plan runs exactly one trial per case in its base and its candidate arm, under
 * fixed-cases: the domain whose regression result needs the checks of `oneTrialRecords`.
 */
function oneTrialPlan(plan) {
    const base = plan.arms.find((a) => a.role === "base")?.name;
    const candidate = plan.arms.find((a) => a.role === "candidate")?.name;
    if (plan.estimand !== "fixed-cases" || base === undefined || candidate === undefined)
        return false;
    const cells = new Map();
    const cases = new Set();
    for (const t of plan.trials) {
        cases.add(t.case);
        if (t.arm !== base && t.arm !== candidate)
            continue;
        const key = `${t.case}\u0000${t.arm}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    return (cases.size > 0 && cells.size === 2 * cases.size && [...cells.values()].every((n) => n === 1));
}
/**
 * The largest number of trials whose half-open [startedAt, endedAt) intervals overlap. An end sorts
 * before a start at the same time, so a trial that starts as another ends does not overlap it: a
 * sequential runner reads as concurrency 1. Closed intervals would raise c and loosen the rank rule.
 */
function concurrencyOf(intervals) {
    const events = [...intervals]
        .flatMap((i) => [
        { at: i.start, step: 1 },
        { at: i.end, step: -1 },
    ])
        .toSorted((a, b) => a.at - b.at || a.step - b.step);
    let open = 0;
    let most = 0;
    for (const e of events) {
        open += e.step;
        most = Math.max(most, open);
    }
    return most;
}
/**
 * The checks of a run at one trial per case and arm (VALIDATION.md, "Conditions for a validated
 * result at one trial per case"). Every trial that ran must record when it started and ended. Then
 * a case's pair holds only when its arms ran in the order `candidateRunsFirst` chose (a tie is not
 * the other order) and their ranks by start time, ties broken by trial ID, differ by at most
 * 2c − 1, where c is the most trials the records show running at once. A case whose pair does not
 * hold is unpaired: it counts as missing, so one lost pair never invalidates a run, and the
 * coverage floor decides how many may be lost. The plan must state its schedule and cite at least
 * two clean A/A decisions (`aaLimitations`), unless it is itself an A/A plan.
 */
function oneTrialRecords(input, pair) {
    const { plan } = input;
    const limitations = [];
    const unpaired = new Set();
    let concurrency;
    // A trial that never ran has no time to show.
    const ran = input.trials.filter((t) => t.outcome !== "not_run");
    const times = new Map();
    for (const t of ran) {
        const start = t.startedAt === undefined ? Number.NaN : Date.parse(t.startedAt);
        const end = t.endedAt === undefined ? Number.NaN : Date.parse(t.endedAt);
        if (start <= end)
            times.set(t.id, { start, end });
    }
    if (times.size < ran.length)
        limitations.push(NO_TIMES);
    else {
        const c = concurrencyOf(times.values());
        concurrency = c;
        const startOf = (id) => times.get(id)?.start ?? Number.NaN;
        const ranked = ran
            .map((t) => t.id)
            .toSorted((a, b) => startOf(a) - startOf(b) || byCodeUnits(a, b));
        const rank = new Map(ranked.map((id, i) => [id, i]));
        const trialOf = new Map(plan.trials.map((t) => [`${t.case}\u0000${t.arm}`, t.id]));
        for (const id of new Set(plan.trials.map((t) => t.case))) {
            const base = trialOf.get(`${id}\u0000${pair.base}`) ?? "";
            const candidate = trialOf.get(`${id}\u0000${pair.candidate}`) ?? "";
            const rb = rank.get(base);
            const rc = rank.get(candidate);
            // A pair without both trials on record is missing a trial already.
            if (rb === undefined || rc === undefined)
                continue;
            const [first, second] = candidateRunsFirst(plan.seed, id, 0)
                ? [candidate, base]
                : [base, candidate];
            if (startOf(second) < startOf(first) || Math.abs(rb - rc) > 2 * c - 1)
                unpaired.add(id);
        }
    }
    if (plan.schedule === undefined)
        limitations.push("the plan states no schedule (concurrency and endpoint), which one trial per case needs");
    const identity = (name) => plan.arms.find((a) => a.name === name)?.identity;
    // An A/A plan is the evidence itself, so it waives its own A/A precondition and nothing else.
    if (identity(pair.base) !== identity(pair.candidate))
        limitations.push(...aaLimitations(plan, input.aa ?? []));
    return {
        unpaired,
        checks: { checksPassed: limitations.length === 0, limitations },
        ...(concurrency === undefined ? {} : { concurrency }),
    };
}
/** The models of a plan's base arm, sorted by role, as the identity projection compares them. */
function baseModels(plan) {
    const models = plan.arms.find((a) => a.role === "base")?.configuration.models ?? [];
    return canonicalize(models.toSorted((a, b) => byCodeUnits(a.role, b.role)));
}
/**
 * The A/A precondition of a plan at one trial per case (VALIDATION.md). The plan cites at least two
 * distinct A/A decisions, and each one is given with its plan and run and passes every check: its
 * digests match (the cited decision digest, its plan and its run); both arms are one
 * configuration; it runs one trial per case and arm; it ran this plan's suite; it is a decision,
 * not INVALID, whose every primary regression result is validated; no primary measure gave
 * REGRESSION; and it ran this plan's base model and schedule. Each failure is one limitation that
 * names the check and the run.
 */
function aaLimitations(plan, given) {
    const cited = new Map((plan.aa?.decisions ?? []).map((c) => [c.run, c.digest]));
    const out = [];
    if (cited.size < 2)
        out.push(`one trial per case needs at least two A/A decisions, and the plan cites ${cited.size}`);
    for (const [run, cite] of cited) {
        const fail = (problem) => void out.push(`A/A run '${run}': ${problem}`);
        const e = given.find((g) => g.decision.run === run);
        if (!e) {
            fail("no decision record was given");
            continue;
        }
        // Records that do not match their digests prove nothing, so no other check reads them.
        const before = out.length;
        if (digest(e.decision) !== cite)
            fail("its decision record does not match the cited digest");
        if (e.decision.plan !== digest(e.plan))
            fail("its decision does not belong to the given plan");
        if (e.decision.runDigest !== digest(e.run))
            fail("its decision does not belong to the given run");
        if (out.length > before)
            continue;
        const arms = e.plan.arms.filter((a) => a.role === "base" || a.role === "candidate");
        if (arms.length !== 2 || new Set(arms.map((a) => a.identity)).size !== 1)
            fail("its arms are not one configuration, so it is not an A/A comparison");
        if (!oneTrialPlan(e.plan))
            fail("it does not run one trial per case and arm");
        if (e.plan.suiteDigest !== plan.suiteDigest)
            fail("it ran another suite");
        const primaries = e.decision.measures.filter((m) => m.tier === "primary");
        const validated = e.decision.mode === "decision" &&
            e.decision.verdict !== "INVALID" &&
            primaries.length > 0 &&
            primaries.every((m) => m.comparisons.length > 0 && m.comparisons.every((c) => c.regression.validated));
        if (!validated)
            fail("its regression results are not validated");
        if (primaries.some((m) => m.verdict === "REGRESSION"))
            fail("a primary measure gave REGRESSION");
        if (baseModels(e.plan) !== baseModels(plan))
            fail("its model differs from this plan's base arm");
        if (plan.schedule === undefined ||
            canonicalize(e.plan.schedule ?? null) !== canonicalize(plan.schedule))
            fail("its schedule differs from this plan's");
    }
    return out;
}
function seedOf(plan) {
    return Number((BigInt(plan.seed.value) % 4294967295n) + 1n);
}
const emptyAvailability = () => ({
    planned: 0,
    available: 0,
    notApplicable: 0,
    missing: 0,
    successes: 0,
    trials: 0,
});
/** Whether a value says that its trial passed: a binary pass, or a proportion with a success. */
function passing(value) {
    return ((value?.type === "binary" && value.pass) ||
        (value?.type === "proportion" && value.successes > 0));
}
/**
 * Collects one measure's counts. A system failure or a budget overrun is a failed trial. A missing
 * trial (an infrastructure failure, including a capture failure, a trial not run, an invalid
 * configuration, or a trial without a value) is left out, unless an imputation gives it an outcome
 * for the sensitivity analysis.
 */
function tally(plan, trials, values, measure, arms, imputation, unpaired = NO_CASES) {
    const cases = new Map();
    const availability = new Map();
    let unsupported;
    let valueType = "binary";
    for (const planned of plan.trials) {
        const av = availability.get(planned.arm) ?? emptyAvailability();
        availability.set(planned.arm, av);
        const value = values.get(`${measure}\u0000${planned.id}`);
        if (value && !value.applicable) {
            av.notApplicable++;
            continue;
        }
        av.planned++;
        const outcome = trials.get(planned.id)?.outcome ?? "not_run";
        const side = planned.arm === arms?.base
            ? "base"
            : planned.arm === arms?.candidate
                ? "candidate"
                : undefined;
        const v = value?.value;
        if (!MISSING.has(outcome) && v !== undefined && v.type !== "binary") {
            valueType = v.type;
            unsupported = `measure '${measure}' has a ${v.type} value; the decision rule decides binary values only (decision 0008)`;
            av.missing++;
            continue;
        }
        let pass;
        if (FAILED.has(outcome)) {
            pass = false;
            av.available++;
        }
        else if (MISSING.has(outcome) ||
            v === undefined ||
            // A case that lost its pair at one trial per case counts as missing, as a lost trial does.
            (side !== undefined && unpaired.has(planned.case))) {
            av.missing++;
            const imputed = side === undefined ? undefined : imputation?.[side];
            if (imputed === undefined)
                continue;
            pass = imputed;
        }
        else {
            pass = v.type === "binary" && v.pass;
            av.available++;
        }
        av.successes += pass ? 1 : 0;
        av.trials += 1;
        if (side === undefined)
            continue;
        const entry = cases.get(planned.case) ?? {
            id: planned.case,
            ...(planned.family === undefined ? {} : { family: planned.family }),
            base: { successes: 0, trials: 0 },
            candidate: { successes: 0, trials: 0 },
        };
        cases.set(planned.case, {
            ...entry,
            [side]: { successes: entry[side].successes + (pass ? 1 : 0), trials: entry[side].trials + 1 },
        });
    }
    return {
        cases,
        arms: availability,
        valueType,
        ...(unsupported === undefined ? {} : { unsupported }),
    };
}
function flipsOf(cases) {
    const flips = [];
    for (const c of cases.values()) {
        if (c.base.trials === 0 || c.candidate.trials === 0)
            continue;
        const b = c.base.successes / c.base.trials;
        const k = c.candidate.successes / c.candidate.trials;
        // The majority outcome counts; a tie is neither good nor bad, so it never flips.
        if (b > 0.5 && k < 0.5)
            flips.push({ case: c.id, direction: "negative", base: b, candidate: k });
        else if (b < 0.5 && k > 0.5)
            flips.push({ case: c.id, direction: "positive", base: b, candidate: k });
    }
    return flips.toSorted((x, y) => x.direction === y.direction ? (x.case < y.case ? -1 : 1) : x.direction === "negative" ? -1 : 1);
}
/**
 * The identity projection of a configuration as factor keys, each with its part: every model,
 * generation parameter, prompt (by digest) and factor. Two arms with the same keys and values have
 * the same identity.
 */
function identityFactors(config) {
    const out = new Map();
    if (!config)
        return out;
    for (const m of config.models)
        out.set(`model.${m.role}`, { value: canonicalize(m), part: "model" });
    for (const p of config.parameters)
        out.set(`parameter.${p.name}`, { value: canonicalize(p), part: "parameter" });
    for (const p of config.prompts)
        out.set(`prompt.${p.name}`, { value: canonicalize([p.digest, p.status]), part: "prompt" });
    for (const [n, f] of Object.entries(config.factors))
        out.set(`factor.${n}`, { value: canonicalize(f), part: f.part });
    return out;
}
/** The factor keys in which two arms differ, with their parts, sorted by key. */
function differences(plan, base, candidate) {
    const fb = identityFactors(plan.arms.find((a) => a.name === base)?.configuration);
    const fc = identityFactors(plan.arms.find((a) => a.name === candidate)?.configuration);
    return [...new Set([...fb.keys(), ...fc.keys()])]
        .filter((k) => fb.get(k)?.value !== fc.get(k)?.value)
        .toSorted()
        .map((key) => ({ key, part: (fb.get(key) ?? fc.get(key))?.part ?? "other" }));
}
/** The part an observation belongs to: the first segment of its dotted name, else `other`. */
function observationPart(name) {
    const head = name.split(".")[0] ?? "";
    return FactorPart.safeParse(head).data ?? "other";
}
/**
 * What a run can change to allow each undeclared difference: a trigger that varies its part, or
 * `--vary` for the factor. A trigger that varies nothing in the system takes no `--vary`.
 */
function howToAllow(plan, undeclared) {
    const canVary = TRIGGER_VARIES[plan.trigger] !== null;
    const advice = undeclared.flatMap(({ key, part }) => {
        const options = [
            ...Object.entries(TRIGGER_VARIES)
                .filter(([, parts]) => parts?.includes(part))
                .map(([trigger]) => `--trigger ${trigger}`),
            ...(canVary ? [`--vary ${key}`] : []),
        ];
        const last = options.pop();
        return last === undefined
            ? []
            : [`${key}: ${options.length > 0 ? `${options.join(", ")} or ` : ""}${last}`];
    });
    return advice.length > 0
        ? `. To allow ${advice.length > 1 ? "them" : "it"}, use ${advice.join("; ")}`
        : "";
}
/**
 * REQ-15: arms may differ only in what the trigger varies by its kind and what the plan declares
 * as varied. This covers the whole identity projection (models, parameters, prompts, factors) and
 * the factors each arm's trials report: an observation present in both arms whose reported values
 * differ must belong to a part the change varies.
 */
function triggerCheck(plan, pair, trials) {
    const kinds = TRIGGER_VARIES[plan.trigger];
    const declared = new Set(plan.varies);
    const problems = [];
    if (kinds === null && declared.size > 0)
        problems.push(`a ${plan.trigger} change varies nothing in the system, but the plan declares ${[...declared].join(", ")} as varied`);
    const allowed = new Set(kinds ?? []);
    const may = kinds === null
        ? "may not vary the system at all"
        : `may vary only ${kinds.length > 0 ? `the ${kinds.join(" and ")} part and ` : ""}what the plan declares as varied`;
    const diffs = differences(plan, pair.base, pair.candidate);
    const undeclared = diffs.filter((d) => !allowed.has(d.part) && !declared.has(d.key));
    if (undeclared.length > 0)
        problems.push(`a ${plan.trigger} change ${may}, but the arms also differ in ${undeclared.map((d) => d.key).join(", ")}${howToAllow(plan, undeclared)}`);
    // Observations may differ in the parts the change varies, including the parts of what it declares.
    const observable = new Set(allowed);
    for (const d of diffs)
        if (declared.has(d.key))
            observable.add(d.part);
    const arms = new Map(plan.trials.map((t) => [t.id, t.arm]));
    const seen = new Map([
        [pair.base, new Map()],
        [pair.candidate, new Map()],
    ]);
    for (const t of trials) {
        if (t.outcome === "invalid_configuration")
            continue;
        const side = seen.get(arms.get(t.id) ?? "");
        if (!side)
            continue;
        for (const o of t.observed ?? []) {
            const set = side.get(o.name) ?? new Set();
            set.add(canonicalize(o.value));
            side.set(o.name, set);
        }
    }
    const base = seen.get(pair.base);
    const candidate = seen.get(pair.candidate);
    for (const [name, values] of [...base.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
        const other = candidate.get(name);
        if (!other || observationPart(name) === "other" || observable.has(observationPart(name)))
            continue;
        const same = values.size === other.size && [...values].every((v) => other.has(v));
        if (!same)
            problems.push(`the arms' trials report different values of observed '${name}', which a ${plan.trigger} change ${may}`);
    }
    return problems;
}
/** A trial's calls over every attempt, in calls the provider accepted. */
function callsOf(t) {
    return (t.attempts ?? []).reduce((n, a) => n + a.calls, t.usage?.calls ?? 0);
}
/**
 * The trials whose calls Ichnaea's bounds count, and the imported ones, by the plan's arms: an arm
 * with `runs` is Ichnaea's, any other arm's trials are imported. A plan without `callsPerTrial`
 * was written before the plan recorded its bounds, so none of its calls are sorted: it keeps the
 * decision it was given.
 */
function callsByRunner(input) {
    const { plan } = input;
    const bound = plan.budget.callsPerTrial;
    if (bound === undefined)
        return undefined;
    const runs = new Set(plan.arms.filter((a) => a.runs === true).map((a) => a.name));
    const armOf = new Map(plan.trials.map((t) => [t.id, t.arm]));
    const ran = [];
    const imported = [];
    for (const t of input.trials)
        (runs.has(armOf.get(t.id) ?? t.arm ?? "") ? ran : imported).push(t);
    return { bound, ran, imported };
}
/**
 * The limitation that reports an import's calls: another runner made them, so the bounds do not
 * apply, but the card still says how many there were. It counts the trials of the arms Ichnaea
 * does not run. Only a plan that carries `callsPerTrial` gets it, so a stored decision recomputes
 * unchanged; and only when those trials recorded a call.
 */
function importedCallsLimitation(input) {
    const sorted = callsByRunner(input);
    const calls = (sorted?.imported ?? []).reduce((n, t) => n + callsOf(t), 0);
    return calls > 0
        ? [
            `The imported trials recorded ${calls} calls. Ichnaea's budget applies only to the trials it runs.`,
        ]
        : [];
}
/**
 * The checks of each trial's attempts (invariant 12). They are numbered 1 to k with no gap. For
 * the trials of the arms Ichnaea runs, the calls of every attempt count against the plan's bound
 * per trial and against the run's budget, so a retry cannot hide an overrun. Every count is of the
 * calls the provider accepted: a call it rejected, for example with HTTP 429, is not a call, so
 * throttling alone never makes a run INVALID. A trial without a count of calls counts none.
 *
 * The bounds guard what Ichnaea spends. An imported trial's calls were made by another runner: they
 * stay on the trial records, the limitation reports them, and they never make the run INVALID. A
 * plan without `callsPerTrial` was written before the plan recorded its bounds, and its calls are
 * not checked, so it keeps the decision it was given.
 *
 * A plan with `callsPerTrial` must book exactly its worst case: the trials of the arms with `runs`
 * times the bound. Without that, an arm that lost its `runs` would check no call and say nothing,
 * so the bounds fail closed. For the same reason, a plan that marks an arm as run must state
 * `callsPerTrial`.
 */
function attemptChecks(input) {
    const invalid = [];
    for (const t of input.trials) {
        const attempts = t.attempts ?? [];
        if (attempts.some((a, i) => a.attempt !== i + 1))
            invalid.push(`trial '${t.id}' lists attempts ${attempts.map((a) => a.attempt).join(", ")}; they must be numbered 1 to k with no gap`);
    }
    const sorted = callsByRunner(input);
    if (sorted === undefined) {
        // Only a plan from before the bounds lacks callsPerTrial, and it marks no arm as run.
        const runs = input.plan.arms.filter((a) => a.runs === true).map((a) => a.name);
        if (runs.length > 0)
            invalid.push(`the plan marks arm(s) ${runs.join(", ")} as run by Ichnaea but states no bound of calls per trial`);
        return invalid;
    }
    const { bound, ran } = sorted;
    const { worstCaseCalls } = input.plan.budget;
    const runs = new Set(input.plan.arms.filter((a) => a.runs === true).map((a) => a.name));
    const runTrials = input.plan.trials.filter((t) => runs.has(t.arm)).length;
    if (worstCaseCalls !== runTrials * bound)
        invalid.push(`the plan books ${worstCaseCalls} calls in the worst case, but its ${runTrials} trial(s) of the arms Ichnaea runs need ${runTrials * bound} at the bound of ${bound} per trial`);
    const over = [];
    let total = 0;
    for (const t of ran) {
        const calls = callsOf(t);
        total += calls;
        if (calls > bound)
            over.push({ trial: t.id, calls });
    }
    const example = over[0];
    if (example)
        invalid.push(`${over.length} trial(s) made more calls over their attempts than the bound of ${bound} per trial, for example '${example.trial}' (${example.calls} calls)`);
    const { maxCalls } = input.plan.budget;
    if (total > maxCalls)
        invalid.push(`the run made ${total} calls, over the budget of ${maxCalls}, counting every attempt`);
    return invalid;
}
/** Checks of the records themselves. Each problem makes the run INVALID. */
function recordChecks(input) {
    const { plan, run } = input;
    const invalid = [];
    const planDigest = digest(plan);
    if (run.plan !== planDigest)
        invalid.push(`the run belongs to plan ${run.plan}, not to this plan (${planDigest})`);
    for (const error of verifyArms(plan.arms))
        invalid.push(`stored configuration at ${error.path} does not match (${error.computed})`);
    const names = plan.arms.map((a) => a.name);
    if (new Set(names).size !== names.length)
        invalid.push("the plan has duplicate arm names");
    if (plan.arms.filter((a) => a.role === "base").length > 1)
        invalid.push("the plan has two base arms");
    if (plan.arms.filter((a) => a.role === "candidate").length > 1)
        invalid.push("the plan has more than one candidate arm, which is not supported yet (REQ-57)");
    const plannedById = new Map(plan.trials.map((t) => [t.id, t]));
    if (plannedById.size !== plan.trials.length)
        invalid.push("the plan has duplicate trial IDs");
    invalid.push(...recordProblems(input));
    const protocol = input.trials.filter((t) => t.outcome === "protocol_failure");
    for (const kind of new Set(protocol.map((t) => t.error?.kind ?? "unknown")))
        invalid.push(`a worker reported a protocol failure (${kind}): the harness, not the system, failed`);
    const unplannedTrial = input.trials.find((t) => !plannedById.has(t.id));
    if (unplannedTrial)
        invalid.push(`trial '${unplannedTrial.id}' is not in the plan`);
    // A value counts for the planned trial's case and arm, so a trial must name exactly those.
    const renamed = input.trials.flatMap((t) => {
        const p = plannedById.get(t.id);
        return p && (t.case !== p.case || t.arm !== p.arm || t.replicate !== p.replicate)
            ? [{ t, p }]
            : [];
    });
    const firstRenamed = renamed[0];
    if (firstRenamed) {
        const { t, p } = firstRenamed;
        invalid.push(`${renamed.length} trial(s) name another case, arm or replicate than their planned trial, for example trial '${t.id}' names case '${t.case}', arm '${t.arm}', replicate ${t.replicate}, but the plan has case '${p.case}', arm '${p.arm}', replicate ${p.replicate}`);
    }
    const unplannedValue = input.values.find((v) => !plannedById.has(v.trial));
    if (unplannedValue)
        invalid.push(`a value names trial '${unplannedValue.trial}', which is not in the plan`);
    for (const v of input.values) {
        const problem = v.applicable && v.value ? proportionProblem(v.value) : undefined;
        if (problem)
            invalid.push(`measure '${v.measure}' on trial '${v.trial}': ${problem}`);
    }
    // A failed trial that carries a passing value contradicts itself: the importer is wrong.
    const outcomes = new Map(input.trials.map((t) => [t.id, t.outcome]));
    const contradicting = input.values.filter((v) => v.applicable && FAILED.has(outcomes.get(v.trial) ?? "") && passing(v.value));
    const first = contradicting[0];
    if (first)
        invalid.push(`${contradicting.length} failed trial(s) carry a passing value, for example '${first.trial}' (${outcomes.get(first.trial)}) for '${first.measure}'; the records contradict themselves`);
    for (const g of input.gates)
        if (g.passed === g.failures > 0)
            invalid.push(`gate '${g.gate}' says passed ${g.passed} with ${g.failures} failure(s)`);
    for (const id of plan.hardGates)
        if (!input.gates.some((g) => g.gate === id))
            invalid.push(`hard gate '${id}' has no result`);
    if (plan.budget.worstCaseCalls > plan.budget.maxCalls)
        invalid.push(`the plan needs ${plan.budget.worstCaseCalls} calls, over the budget of ${plan.budget.maxCalls}`);
    if (plan.budget.monthlyRemaining !== undefined &&
        plan.budget.worstCaseCalls > plan.budget.monthlyRemaining)
        invalid.push(`the plan needs ${plan.budget.worstCaseCalls} calls, over the ${plan.budget.monthlyRemaining} left this month`);
    if (input.trials.some((t) => t.outcome === "budget_exceeded"))
        invalid.push("the run exhausted its budget");
    invalid.push(...attemptChecks(input));
    for (const p of plan.primary) {
        if (!(p.margin < 1 && (p.safetyMargin ?? 0) <= p.margin))
            invalid.push(`measure '${p.measure}': the margin must be below 1 and at least the safety margin`);
        if (plan.mode === "decision" && p.marginStatus === "placeholder")
            invalid.push(`measure '${p.measure}': a placeholder margin gives no verdict, but the plan is in decision mode`);
    }
    return invalid;
}
/**
 * Whether counts may claim "beyond run-to-run noise" (decision 0016): some case is compared, and
 * every compared case has at least 2 trials in each arm.
 */
function replicated(cases) {
    let compared = false;
    for (const c of cases) {
        if (c.base.trials === 0 || c.candidate.trials === 0)
            continue;
        compared = true;
        if (c.base.trials < 2 || c.candidate.trials < 2)
            return false;
    }
    return compared;
}
/** The limitations of a comparison's non-inferiority result that its regression result lacks. */
function nonInferiorityOnly(comparison) {
    const domain = new Set(comparison.regression.limitations);
    return comparison.nonInferiority.limitations.filter((l) => !domain.has(l));
}
/**
 * Whether the unset margin floor alone keeps a comparison from NON-INFERIOR: its regression result
 * is validated, its lower bound clears the effective margin, and the floor is the only limitation
 * of its non-inferiority result.
 */
function onlyTheFloor(c, effective) {
    if (!c?.regression.validated || !(c.difference.lower > -effective))
        return false;
    const limitations = nonInferiorityOnly(c);
    return limitations.length === 1 && limitations[0] === MARGIN_FLOOR_NOT_SET;
}
/**
 * Per-measure verdicts for the primary measures (DESIGN § 6.3, REQ-51, decision 0015):
 * NON-INFERIOR when both results of the comparison are validated and the one-sided lower bound
 * exceeds −(δ − s), each at the unadjusted level (intersection-union, so a PASS needs no
 * adjustment); otherwise REGRESSION when the regression result is validated and the regression test
 * rejects Δ ≥ 0 after Holm across the comparisons whose regression result is validated; otherwise
 * INCONCLUSIVE. Holm covers only the tests that can produce REGRESSION, and a comparison whose
 * regression result is not validated cannot (decision 0008), so it stays out of the family. Whether
 * a result is validated depends on the cases, trials and margin, not on the outcomes, so the family
 * still holds the error rate at α. The measures are decided in order with one generator from
 * `seed`, so the same counts give the same verdicts.
 */
export function decidePrimaries(input) {
    return decidePrimariesWith(input, compareCounts);
}
/** `decidePrimaries` with the comparison given, so a test can decide from results of its own. */
export function decidePrimariesWith(input, compare) {
    const verdicts = new Map();
    const rng = createRng(input.seed);
    for (const p of input.measures) {
        const effective = p.margin - (p.safetyMargin ?? 0);
        if (!(effective >= 0 && p.margin < 1)) {
            // The run is INVALID for this already (recordChecks); no comparison can use the margin.
            verdicts.set(p.measure, {
                verdict: "INCONCLUSIVE",
                cause: "no-comparison",
                notes: ["the margin cannot be used"],
            });
            continue;
        }
        try {
            const valueType = STATS_VALUE_TYPE[p.valueType];
            if (valueType === undefined)
                throw new EstimandError(`a ${p.valueType} measure has no paired method`);
            const comparison = compare({
                estimand: input.estimand,
                valueType,
                cases: p.cases,
                alpha: input.alpha,
                margin: effective,
                rng,
                ...(input.oneTrial === undefined ? {} : { oneTrial: input.oneTrial }),
            });
            const notValidated = nonInferiorityOnly(comparison).map((l) => `the non-inferiority result is not validated: ${l}`);
            if (!comparison.regression.validated) {
                verdicts.set(p.measure, {
                    verdict: "INCONCLUSIVE",
                    comparison,
                    cause: "unvalidated",
                    notes: [
                        ...comparison.regression.limitations.map((l) => `outside the validated domain: ${l}`),
                        ...notValidated,
                    ],
                });
                continue;
            }
            const nonInferior = comparison.difference.lower > -effective;
            if (!nonInferior) {
                verdicts.set(p.measure, {
                    verdict: "INCONCLUSIVE",
                    comparison,
                    cause: "cannot-tell",
                    notes: notValidated,
                });
                continue;
            }
            if (!comparison.nonInferiority.validated) {
                verdicts.set(p.measure, {
                    verdict: "INCONCLUSIVE",
                    comparison,
                    cause: "non-inferiority-unvalidated",
                    notes: notValidated,
                });
                continue;
            }
            verdicts.set(p.measure, { verdict: "NON-INFERIOR", comparison, notes: [] });
        }
        catch (error) {
            if (!(error instanceof EstimandError))
                throw error;
            verdicts.set(p.measure, {
                verdict: "INCONCLUSIVE",
                cause: "no-comparison",
                notes: [error.message],
            });
        }
    }
    const family = [...verdicts.entries()].filter(([, v]) => v.comparison?.regression.validated === true);
    const pAdjusted = holm(family.map(([, v]) => v.comparison.regressionP));
    family.forEach(([id, v], i) => {
        const pa = pAdjusted[i];
        const comparison = v.comparison;
        if (pa > input.alpha) {
            verdicts.set(id, { ...v, regressionPAdjusted: pa });
            return;
        }
        if (v.verdict !== "NON-INFERIOR") {
            const { cause: _cause, ...rest } = v;
            verdicts.set(id, { ...rest, verdict: "REGRESSION", regressionPAdjusted: pa });
        }
        else {
            const cases = input.measures.find((p) => p.measure === id)?.cases ?? [];
            verdicts.set(id, {
                ...v,
                regressionPAdjusted: pa,
                notes: [
                    ...v.notes,
                    `a drop smaller than the margin is ${replicated(cases) ? "beyond run-to-run noise" : "significant"}: compatible with a drop of up to ${(Math.abs(comparison.difference.lower) * 100).toFixed(1)} points`,
                ],
            });
        }
    });
    return verdicts;
}
function primaryVerdicts(plan, tallies, compare, oneTrial) {
    return decidePrimariesWith({
        estimand: plan.estimand,
        alpha: plan.alpha,
        seed: seedOf(plan),
        ...(oneTrial === undefined ? {} : { oneTrial }),
        measures: plan.primary.map((p) => {
            const t = tallies.get(p.measure);
            return {
                measure: p.measure,
                margin: p.margin,
                ...(p.safetyMargin === undefined ? {} : { safetyMargin: p.safetyMargin }),
                valueType: t.valueType,
                cases: [...t.cases.values()],
            };
        }),
    }, compare);
}
function estimateOf(difference) {
    return {
        estimate: difference.estimate,
        lower: difference.lower,
        upper: difference.upper,
        level: difference.level,
        sided: "lower",
        method: difference.method,
    };
}
/** One result of a comparison, as the decision records it. */
const recorded = (v) => v.validated
    ? { validated: true, limitations: [] }
    : { validated: false, limitations: [...v.limitations] };
/** Both results of a comparison, as the decision records them. */
function validityOf(c) {
    return { regression: recorded(c.regression), nonInferiority: recorded(c.nonInferiority) };
}
/** Both results of a comparison that could not be made, for the reason given. */
function noValidity(reason) {
    const result = { validated: false, limitations: [reason] };
    return { regression: result, nonInferiority: result };
}
/** A difference of rates without an interval, for a measure that has no comparison. */
function rateDifference(t, base, candidate, level) {
    const b = t.arms.get(base);
    const c = t.arms.get(candidate);
    const diff = b && c && b.trials > 0 && c.trials > 0
        ? c.successes / c.trials - b.successes / b.trials
        : Number.NaN;
    return {
        estimate: Number.isFinite(diff) ? diff : NAN,
        lower: NEG_INF,
        upper: POS_INF,
        level,
        sided: "lower",
        method: "descriptive (no interval)",
    };
}
/**
 * The comparison of a measure that gives no verdict: a secondary measure, or any measure of an
 * estimate-only decision (REQ-27, REQ-129). It carries the fixed-cases interval with its validated
 * status and limitations, and no test: it is descriptive. When the data supports no interval, the
 * difference has none and the notes say why.
 */
function descriptiveComparison(plan, t, pair, margin, safetyMargin, compare, oneTrial) {
    const common = {
        base: pair.base,
        candidate: pair.candidate,
        margin,
        safetyMargin,
        nonInferiorityP: NAN,
        regressionP: NAN,
        regressionPAdjusted: NAN,
        regressionMethod: "none (descriptive)",
        flips: flipsOf(t.cases),
    };
    try {
        const valueType = STATS_VALUE_TYPE[t.valueType];
        if (valueType === undefined)
            throw new EstimandError(`a ${t.valueType} measure has no paired method`);
        const c = compare({
            estimand: plan.estimand,
            valueType,
            cases: [...t.cases.values()],
            alpha: plan.alpha,
            margin: Math.max(margin - safetyMargin, 0),
            rng: createRng(seedOf(plan)),
            ...(oneTrial === undefined ? {} : { oneTrial }),
        });
        return {
            comparison: { ...common, difference: estimateOf(c.difference), ...validityOf(c) },
            // regression.validated never vouches for the interval: only nonInferiority does.
            notes: c.nonInferiority.limitations.map((l) => `the interval is not validated: ${l}`),
        };
    }
    catch (error) {
        if (!(error instanceof EstimandError))
            throw error;
        return {
            comparison: {
                ...common,
                difference: rateDifference(t, pair.base, pair.candidate, 1 - plan.alpha),
                ...noValidity(error.message),
            },
            notes: [`no interval: ${error.message}`],
        };
    }
}
function sensitivityResult(imputation, v, changesVerdict, level) {
    return {
        imputation,
        difference: v.comparison
            ? estimateOf(v.comparison.difference)
            : {
                estimate: NAN,
                lower: NEG_INF,
                upper: POS_INF,
                level,
                sided: "lower",
                method: "none (no comparison)",
            },
        nonInferiorityP: v.comparison?.nonInferiorityP ?? NAN,
        regressionPAdjusted: v.regressionPAdjusted ?? NAN,
        ...(v.comparison ? validityOf(v.comparison) : noValidity(v.notes[0] ?? "no comparison")),
        verdict: v.verdict,
        changesVerdict,
    };
}
/**
 * Whether a verdict of this run may say "beyond run-to-run noise" (decision 0016): only under
 * fixed-cases, and only when every case the primary measures compare has at least 2 trials in each
 * arm. The scope sentence and the REGRESSION reason both read it, so they never disagree.
 */
function beyondNoise(plan, tallies) {
    const cases = plan.primary.flatMap((p) => [...(tallies.get(p.measure)?.cases.values() ?? [])]);
    return plan.estimand === "fixed-cases" && replicated(cases);
}
/**
 * The scope sentence of a verdict, built from the records (decision 0011). An INVALID decision
 * makes no claim. A failed hard gate says that a deterministic check failed. Otherwise it names the
 * cases the primary measures compare, and says "beyond run-to-run noise" only when `noise` holds
 * (`beyondNoise`).
 */
function scopeOf(verdict, gateFailed, plan, tallies, noise) {
    const compared = new Set();
    for (const p of plan.primary)
        for (const c of tallies.get(p.measure)?.cases.values() ?? [])
            if (c.base.trials > 0 && c.candidate.trials > 0)
                compared.add(c.id);
    const cases = compared.size > 0 ? compared.size : new Set(plan.trials.map((t) => t.case)).size;
    if (verdict === "INVALID")
        return { scope: "no claim: the records fail a check", cases };
    if (gateFailed)
        return { scope: "a deterministic check failed", cases };
    const fixed = plan.estimand === "fixed-cases";
    if (verdict === null)
        return {
            scope: fixed
                ? `estimates on these ${cases} cases, without a verdict`
                : `estimates on ${cases} randomly drawn cases, without a verdict`,
            cases,
        };
    if (!fixed)
        return { scope: `on the population these ${cases} randomly drawn cases represent`, cases };
    return {
        scope: `on these ${cases} cases${noise ? ", beyond run-to-run noise" : ""}`,
        cases,
    };
}
/**
 * Why a comparison is not non-inferior, for a measure the floor alone does not explain: no
 * comparison, outside the validated domain, a lower bound that does not clear the effective margin
 * (with the floor named as well, because it also stands in the way), or a non-inferiority result
 * that is not validated for more than the floor.
 */
function shortfall(v, effective, many) {
    const its = many ? "their" : "its";
    const c = v?.comparison;
    if (!c)
        return `${many ? "they have" : "it has"} no comparison (${v?.notes[0] ?? "no data"})`;
    if (!c.regression.validated)
        return `${many ? "their comparisons are" : "its comparison is"} outside the validated domain`;
    if (v.verdict === "REGRESSION")
        return `${many ? "they regress" : "it regresses"}`;
    const limitations = nonInferiorityOnly(c);
    const unvalidated = limitations.length === 0
        ? ""
        : limitations.length === 1 && limitations[0] === MARGIN_FLOOR_NOT_SET
            ? "the validated margin floor is not set"
            : `${its} non-inferiority result is not validated, because ${limitations.join("; ")}`;
    if (!(c.difference.lower > -effective))
        return `the cases cannot tell yet${unvalidated ? `, and ${unvalidated}` : ""}`;
    return unvalidated || `${many ? "they are" : "it is"} not shown non-inferior`;
}
/**
 * The cause of one INCONCLUSIVE primary measure (decision 0015): the sensitivity analysis changed
 * its verdict; the unset floor alone stands in the way (its lower bound clears the effective margin,
 * also with its missing trials imputed against non-inferiority); or what `shortfall` names. Missing
 * trials are called the measure's own only when it misses some.
 */
function inconclusiveCause(v, effective, s) {
    if (s.changed) {
        const whose = (many) => s.missesOwnTrials
            ? `${many ? "their" : "its"} missing trials`
            : "the missing trials of other primary measures";
        return {
            onlyTheFloor: false,
            text: (many) => `imputing ${whose(many)} against the verdict changes ${many ? "them" : "it"}`,
        };
    }
    if (onlyTheFloor(v?.comparison, effective)) {
        const imputed = s.missesOwnTrials ? s.againstNonInferiority : undefined;
        if (imputed === undefined || onlyTheFloor(imputed.comparison, effective))
            return { onlyTheFloor: true, text: () => FLOOR_CAUSE };
        return {
            onlyTheFloor: false,
            text: (many) => `with ${many ? "their" : "its"} missing trials imputed against non-inferiority, ${shortfall(imputed, effective, many)}`,
        };
    }
    return { onlyTheFloor: false, text: (many) => shortfall(v, effective, many) };
}
/** The INCONCLUSIVE reason that names each measure's cause, with measures of one cause together. */
function inconclusiveReason(open) {
    const groups = new Map();
    for (const o of open) {
        const key = o.cause.text(false);
        const group = groups.get(key);
        if (group)
            group.measures.push(o.measure);
        else
            groups.set(key, { measures: [o.measure], cause: o.cause });
    }
    const parts = [...groups.values()].map(({ measures, cause }) => ({
        who: measures.length === 1
            ? `Measure ${measures[0]}`
            : `Measures ${measures.slice(0, -1).join(", ")} and ${measures.at(-1)}`,
        why: cause.text(measures.length > 1),
    }));
    const [only] = parts;
    if (parts.length === 1 && only)
        return `${only.who} could not be shown non-inferior: ${only.why}. This is not a pass.`;
    return `Not every primary measure was shown non-inferior. ${parts.map((p) => `${p.who}: ${p.why}.`).join(" ")} This is not a pass.`;
}
/**
 * Applies the decision rule to stored records (DESIGN § 6.3, § 6.4, decision 0011).
 *
 * The run verdict, in this order: INVALID when the records fail a check (the run does not belong to
 * the plan, an identity or template does not match, duplicate, unplanned or self-contradicting
 * records, a gate without a result, the budget, arms that differ beyond what the trigger varies and
 * the plan declares, the base has no value, a primary measure's coverage is below its floor); else
 * REGRESSION when a hard gate failed, in either mode, because a gate does not depend on power; else
 * no verdict when the plan is estimate-only or the run is exploratory; else REGRESSION when a
 * primary measure regressed; else PASS when every primary measure is non-inferior; else
 * INCONCLUSIVE. Whenever a primary measure misses a trial in either arm, each measure's verdict is
 * tested against the imputation that works against it, and a verdict that changes is INCONCLUSIVE
 * (decision 0010).
 */
export function decide(input) {
    return decideWith(input, compareCounts);
}
/**
 * `decide` with the comparison given, so a test can decide from results of its own. Not exported
 * by the package: every decision Ichnaea makes uses `compareCounts`.
 */
export function decideWith(input, compare) {
    const { plan, run } = input;
    const invalid = recordChecks(input);
    const trials = new Map(input.trials.map((t) => [t.id, t]));
    const values = new Map(input.values.map((v) => [`${v.measure}\u0000${v.trial}`, v]));
    const baseArm = plan.arms.find((a) => a.role === "base")?.name;
    const candidateArm = plan.arms.find((a) => a.role === "candidate")?.name;
    const pair = baseArm !== undefined && candidateArm !== undefined
        ? { base: baseArm, candidate: candidateArm }
        : undefined;
    if (plan.mode === "decision" && !pair)
        invalid.push("a decision needs a base and a candidate arm");
    if (plan.mode === "decision" && plan.primary.length === 0)
        invalid.push("a decision needs a primary measure");
    if (pair)
        invalid.push(...triggerCheck(plan, pair, input.trials));
    // At one trial per case and arm, the checks of the records decide which pairs hold and whether
    // a regression result can be validated (VALIDATION.md, "One trial per case").
    const one = pair && oneTrialPlan(plan) ? oneTrialRecords(input, pair) : undefined;
    const unpaired = one?.unpaired ?? NO_CASES;
    const pairNote = one?.concurrency !== undefined && unpaired.size > 0
        ? [
            `${unpaired.size} case(s) lost their pair: their trials ran against the planned order or more than ${2 * one.concurrency - 1} start rank(s) apart (concurrency ${one.concurrency} in the records), so they count as missing`,
        ]
        : [];
    // An exploratory run (REQ-16) reports like an estimate-only plan: no confirmatory verdict.
    const modeReasons = run.exploratory
        ? [
            "the run is exploratory: its plan changed after the first trial, so it gives no confirmatory verdict",
            ...plan.modeReasons,
        ]
        : plan.modeReasons;
    const decision = plan.mode === "decision" && !run.exploratory;
    const ids = [
        ...plan.primary.map((p) => p.measure),
        ...plan.secondary.map((s) => s),
    ];
    const tallies = new Map(ids.map((id) => [id, tally(plan, trials, values, id, pair, undefined, unpaired)]));
    const primaryIds = new Set(plan.primary.map((p) => p.measure));
    const compared = pair ? [pair.base, pair.candidate] : plan.arms.map((a) => a.name);
    const coverageOf = (t) => Math.min(...compared.map((arm) => {
        const av = t.arms.get(arm);
        return av && av.planned > 0 ? av.available / av.planned : 0;
    }));
    for (const p of plan.primary) {
        const t = tallies.get(p.measure);
        if (decision && t.unsupported)
            invalid.push(t.unsupported);
        const coverage = coverageOf(t);
        const floor = p.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;
        if (decision && coverage < floor)
            invalid.push(`measure '${p.measure}': coverage ${(coverage * 100).toFixed(1)}% is below its floor of ${(floor * 100).toFixed(1)}%`);
    }
    const tested = decision && pair ? primaryVerdicts(plan, tallies, compare, one?.checks) : undefined;
    // The sensitivity analysis for missing trials (REQ-56, decision 0010): whenever a primary measure
    // misses a trial in either arm, each verdict is tested against the imputation that works
    // against it.
    let sensitivity = "not-needed";
    const changed = new Set();
    const imputed = new Map();
    let againstNonInferiority = new Map();
    const missesOwnTrials = (measure) => pair !== undefined &&
        [pair.base, pair.candidate].some((arm) => (tallies.get(measure)?.arms.get(arm)?.missing ?? 0) > 0);
    const missesTrials = plan.primary.some((p) => missesOwnTrials(p.measure));
    if (tested && pair && missesTrials) {
        const again = (imputation) => primaryVerdicts(plan, new Map(plan.primary.map((p) => [
            p.measure,
            tally(plan, trials, values, p.measure, pair, imputation, unpaired),
        ])), compare, one?.checks);
        againstNonInferiority = again(AGAINST_NON_INFERIORITY);
        const againstRegression = again(AGAINST_REGRESSION);
        for (const [id, v] of tested) {
            const ni = againstNonInferiority.get(id);
            const reg = againstRegression.get(id);
            const changesNi = v.verdict === "NON-INFERIOR" && ni.verdict !== "NON-INFERIOR";
            const changesReg = v.verdict === "REGRESSION" && reg.verdict !== "REGRESSION";
            if (changesNi || changesReg)
                changed.add(id);
            imputed.set(id, [
                sensitivityResult("against-non-inferiority", ni, changesNi, 1 - plan.alpha),
                sensitivityResult("against-regression", reg, changesReg, 1 - plan.alpha),
            ]);
        }
        sensitivity = changed.size > 0 ? "changes-verdict" : "unchanged";
    }
    const measures = ids.map((id) => {
        const t = tallies.get(id);
        const tier = primaryIds.has(id) ? "primary" : "secondary";
        const p = plan.primary.find((x) => x.measure === id);
        const armsOut = plan.arms.map((a) => {
            const av = t.arms.get(a.name) ?? emptyAvailability();
            const rate = wilson({ successes: av.successes, trials: av.trials }, 0.95, "two");
            return {
                arm: a.name,
                rate: {
                    estimate: Number.isFinite(rate.estimate) ? rate.estimate : NAN,
                    lower: rate.lower,
                    upper: rate.upper,
                    level: 0.95,
                    sided: "two",
                    method: "wilson",
                },
                availability: {
                    planned: av.planned,
                    available: av.available,
                    notApplicable: av.notApplicable,
                    missing: av.missing,
                },
            };
        });
        const outcome = {
            measure: id,
            version: plan.measures.find((m) => m.id === id)?.version ?? "0.0.0",
            tier,
            estimand: plan.estimand,
            arms: armsOut,
            coverage: coverageOf(t),
            sensitivity: imputed.get(id) ?? [],
        };
        const result = tier === "primary" ? tested?.get(id) : undefined;
        if (!pair)
            return {
                ...outcome,
                comparisons: [],
                verdict: "ESTIMATE-ONLY",
                notes: t.unsupported ? [t.unsupported] : [],
            };
        const margin = p?.margin ?? 0;
        const safetyMargin = p?.safetyMargin ?? 0;
        if (!result) {
            const described = descriptiveComparison(plan, t, pair, margin, safetyMargin, compare, one?.checks);
            return {
                ...outcome,
                comparisons: [described.comparison],
                verdict: "ESTIMATE-ONLY",
                notes: [
                    ...(t.unsupported ? [t.unsupported] : []),
                    ...(tier === "primary" && !decision ? modeReasons : []),
                    ...pairNote,
                    ...described.notes,
                ],
            };
        }
        const c = result.comparison;
        const notes = [...pairNote, ...result.notes];
        if (c && c.excludedCases > 0)
            notes.push(`${c.excludedCases} case(s) have no completed trial in an arm and count as missing`);
        if (changed.has(id))
            notes.push(`imputing ${missesOwnTrials(id) ? "its missing trials" : "the missing trials of other primary measures"} against this verdict changes it, so it is INCONCLUSIVE (see the sensitivity analysis)`);
        return {
            ...outcome,
            comparisons: [
                {
                    base: pair.base,
                    candidate: pair.candidate,
                    difference: c
                        ? estimateOf(c.difference)
                        : rateDifference(t, pair.base, pair.candidate, 1 - plan.alpha),
                    margin,
                    safetyMargin,
                    nonInferiorityP: c ? c.nonInferiorityP : NAN,
                    regressionP: c ? c.regressionP : NAN,
                    regressionPAdjusted: result.regressionPAdjusted ?? NAN,
                    regressionMethod: c ? c.regressionMethod : "none (no comparison)",
                    ...(c ? validityOf(c) : noValidity(result.notes[0] ?? "no comparison")),
                    flips: flipsOf(t.cases),
                },
            ],
            verdict: changed.has(id) ? "INCONCLUSIVE" : result.verdict,
            notes,
        };
    });
    // Missingness per arm (REQ-56).
    const byArm = plan.arms.map((a) => {
        const planned = plan.trials.filter((t) => t.arm === a.name);
        const missing = planned.filter((t) => MISSING.has(trials.get(t.id)?.outcome ?? "not_run")).length;
        return { arm: a.name, missing, planned: planned.length };
    });
    if (pair) {
        const base = byArm.find((a) => a.arm === pair.base);
        if (base && base.missing === base.planned)
            invalid.push("the base arm has no trial with a value");
    }
    const primaries = measures.filter((m) => m.tier === "primary");
    const gates = input.gates.filter((g) => plan.hardGates.includes(g.gate));
    const failedGate = gates.find((g) => !g.passed);
    const noise = beyondNoise(plan, tallies);
    let verdict;
    let reason;
    if (invalid.length > 0) {
        verdict = "INVALID";
        reason = invalid[0];
    }
    else if (failedGate) {
        // A hard gate is deterministic and does not depend on power, so it decides in both modes.
        verdict = "REGRESSION";
        reason = `Hard gate '${failedGate.gate}' failed.`;
    }
    else if (!decision) {
        verdict = null;
        reason = `Estimate-only: ${modeReasons.join("; ") || "the plan supports no verdict"}. It reports estimates, intervals, differences and flips without a verdict.`;
    }
    else if (primaries.some((m) => m.verdict === "REGRESSION")) {
        verdict = "REGRESSION";
        reason = `Measure ${primaries.find((m) => m.verdict === "REGRESSION")?.measure} dropped${noise ? " beyond run-to-run noise" : ""} and is not shown non-inferior.`;
    }
    else if (primaries.length > 0 && primaries.every((m) => m.verdict === "NON-INFERIOR")) {
        verdict = "PASS";
        reason = "Every primary measure is non-inferior and every hard gate passed.";
    }
    else {
        verdict = "INCONCLUSIVE";
        const open = primaries
            .filter((m) => m.verdict !== "NON-INFERIOR")
            .map((m) => {
            const p = plan.primary.find((x) => x.measure === m.measure);
            return {
                measure: m.measure,
                cause: inconclusiveCause(tested?.get(m.measure), (p?.margin ?? 0) - (p?.safetyMargin ?? 0), {
                    changed: changed.has(m.measure),
                    missesOwnTrials: missesOwnTrials(m.measure),
                    againstNonInferiority: againstNonInferiority.get(m.measure),
                }),
            };
        });
        // The floor alone keeps every measure from NON-INFERIOR: say so in plain words.
        reason =
            open.length > 0 && open.every((o) => o.cause.onlyTheFloor)
                ? FLOOR_NOT_SET_REASON
                : inconclusiveReason(open);
    }
    const { scope, cases } = scopeOf(verdict, verdict === "REGRESSION" && !!failedGate, plan, tallies, noise);
    const limitations = [
        ...(plan.estimand === "fixed-cases" && verdict !== "INVALID"
            ? [`The result is about these ${cases} cases. It makes no claim about new inputs.`]
            : []),
        "An observed model identity cannot detect a silent update behind the same identity.",
        "Hosted models rarely honour seeds; replicates measure run-to-run noise instead.",
        ...(one ? [CLOCK_LIMITATION] : []),
        ...importedCallsLimitation(input),
        ...invalid.slice(1).map((m) => `Also invalid: ${m}`),
    ];
    return Decision.parse({
        schema: "ichnaea.decision/1",
        mode: decision ? "decision" : "estimate-only",
        verdict,
        reason,
        scope,
        plan: digest(plan),
        run: run.id,
        runDigest: digest(run),
        arms: plan.arms.map((a) => ({ name: a.name, role: a.role, identity: a.identity })),
        differingFactors: pair ? differences(plan, pair.base, pair.candidate).map((d) => d.key) : [],
        alpha: plan.alpha,
        measures,
        gates,
        power: {
            planning: planningOf(plan),
            run: runPower(plan, tallies, pair?.base, verdict === "INVALID"),
        },
        missingness: { byArm, differs: new Set(byArm.map((a) => a.missing)).size > 1, sensitivity },
        invalidReasons: invalid,
        limitations,
        seed: plan.seed,
        decidedAt: input.decidedAt,
        ichnaea: input.ichnaea,
        dataClass: "none",
    });
}
/**
 * The run-time power statement (REQ-54, decision 0017): per primary measure, the applicable cases,
 * the zero-noise floor, and the minimum detectable effect simulated from the base arm's per-case
 * rates in this run, labelled with that assumption. It describes the run and never changes its
 * verdict or mode. An INVALID run draws no inference and its base arm may be the broken part, so
 * nothing is simulated: each entry says "run invalid". An entry that cannot be computed says why.
 */
function runPower(plan, tallies, base, invalid) {
    const planned = base === undefined ? new Map() : plannedTrialsPerCase(plan, base);
    return plan.primary.map((p) => {
        const t = tallies.get(p.measure);
        const cases = t ? [...t.cases.values()].filter((c) => c.base.trials > 0) : [];
        const n = cases.length;
        const counts = cases.map((c) => planned.get(c.id) ?? plan.replicates);
        const r = counts.length > 0 ? Math.min(...counts) : plan.replicates;
        const common = { measure: p.measure, applicableCases: n, replicates: r, margin: p.margin };
        const effective = p.margin - (p.safetyMargin ?? 0);
        if (invalid)
            return { computed: false, ...common, reason: "run invalid" };
        if (n === 0 || base === undefined)
            return { computed: false, ...common, reason: "no applicable case with a base value" };
        if (plan.estimand === "sampled-cases") {
            const floor = sampledCasesFloor(n, plan.alpha);
            return {
                computed: true,
                ...common,
                mde: floor,
                floor,
                sampledCasesFloor: floor,
                assumption: "no discordant pairs (a lower bound on the MDE)",
                decidable: floor < effective,
            };
        }
        if (r < 2)
            return {
                computed: false,
                ...common,
                reason: "fixed-cases needs at least 2 trials per case and arm",
            };
        const { mde, floor } = fixedCasesMde({
            rates: cases.map((c) => c.base.successes / c.base.trials),
            replicates: counts,
            alpha: plan.alpha,
            simulations: 1000,
            rng: createRng(seedOf(plan)),
        });
        return {
            computed: true,
            ...common,
            mde,
            floor,
            sampledCasesFloor: sampledCasesFloor(n, plan.alpha),
            assumption: `per-case pass rates of the base arm in this run, trials per case ${describeCounts(counts)}, 1,000 simulations`,
            decidable: mde <= effective,
        };
    });
}
//# sourceMappingURL=decide.js.map