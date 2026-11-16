import { caseDigest, caseSetDigest, candidateRunsFirst, configurationIdentity, digest, Plan, } from "../contracts/index.js";
import { testMeasure } from "./measures.js";
/** Thrown when a suite cannot be resolved into a valid plan. The message names the fix. */
export class PlanError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "PlanError";
}
/** Fewest cases a fixed-cases decision is validated for (VALIDATED_FIXED_CASES in stats). */
export const MIN_DECISION_CASES = 5;
/**
 * The parts of a configuration that each trigger varies by its kind (REQ-15). Arms may differ in
 * these parts and in the factor keys a plan declares in `varies`; any other difference between the
 * arms makes the run INVALID. `null` marks a trigger that changes nothing in the system under
 * evaluation (a case set, a judge, the framework itself, a production signal), so its arms may not
 * differ at all and it cannot declare anything as varied. A code or dependency change varies the
 * code, including its lockfile; a prompt or setting it also changes must be declared.
 */
export const TRIGGER_VARIES = {
    code: ["code"],
    dependency: ["code"],
    configuration: [],
    "configuration-outside": [],
    "new-model": ["model"],
    "silent-change": [],
    "case-set": null,
    judge: null,
    framework: null,
    data: ["data"],
    "production-signal": null,
    manual: [],
};
/** The shape of a factor key in `varies`: the key a decision lists among the differing factors. */
const FACTOR_KEY = /^(model|parameter|prompt|factor)\.\S+$/;
/** Arm names become part of trial IDs, so they cannot contain the separator. */
const ARM_NAME = /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/;
/**
 * Resolves a suite into a locked plan (REQ-16, REQ-19, REQ-21, REQ-49): every planned trial is
 * listed before the first call, with each case's trial count (the suite's, or more for the cases of
 * a `replicatesFor` slice), the worst-case calls are computed, and the estimand's conditions
 * are checked. At one trial per case and arm, the trials run case by case, each pair in the order
 * `candidateRunsFirst` chose; otherwise in alternating batches by replicate (REQ-25). What cannot be resolved is refused with a PlanError that names the fix. What can
 * be measured but not decided runs estimate-only, and `modeReasons` says why: no base and
 * candidate, no primary measure, a primary measure with values no validated method decides yet
 * (decision 0008), a placeholder margin (decision 0012), `sampled-cases` (no validated method yet),
 * one trial in some cases and more in others, one trial per case and arm with a primary measure
 * that is not binary, or fewer than 5 cases. A primary measure must have a primary card that
 * is not a composite (REQ-34).
 */
export async function createPlan(input) {
    const { suite } = input;
    const pools = new Set(suite.pools ?? ["development", "validation", "promoted"]);
    const byId = new Map(input.cases.map((c) => [c.id, c]));
    const entries = input.caseSet.cases;
    if ((await caseSetDigest(entries)) !== input.caseSet.digest)
        throw new PlanError(`case set '${input.caseSet.id}': its digest does not match its entries`);
    if (suite.caseSet.digest && suite.caseSet.digest !== input.caseSet.digest) {
        throw new PlanError(`suite '${suite.id}' pins case set digest ${suite.caseSet.digest}, but the case set is ${input.caseSet.digest}`);
    }
    for (const entry of entries) {
        const c = byId.get(entry.id);
        if (!c)
            throw new PlanError(`case '${entry.id}' is listed in the case set but missing`);
        if ((await caseDigest(c)) !== entry.digest)
            throw new PlanError(`case '${entry.id}' does not match its digest in the case set`);
        if (entry.pool !== c.pool)
            throw new PlanError(`case '${entry.id}' is in pool '${c.pool}', but the case set lists it in '${entry.pool}'`);
        if (entry.family !== c.family)
            throw new PlanError(`case '${entry.id}' has family '${c.family ?? "none"}', but the case set lists '${entry.family ?? "none"}'`);
    }
    const selected = entries.filter((e) => pools.has(e.pool));
    if (selected.some((e) => e.pool === "sealed"))
        throw new PlanError("a sealed pool runs only in a locked confirmatory plan, which this plan is not");
    if (selected.length === 0)
        throw new PlanError(`suite '${suite.id}' selects no case`);
    const selectedCases = selected.map((e) => byId.get(e.id));
    if (suite.estimand === "sampled-cases") {
        const curated = selectedCases.filter((c) => c.provenance.selection !== "random");
        if (curated.length > 0) {
            throw new PlanError(`sampled-cases needs a randomly drawn pool, but ${curated.length} case(s) are ${curated[0]?.provenance.selection}; use fixed-cases`);
        }
    }
    const names = input.arms.map((a) => a.name);
    for (const name of names)
        if (!ARM_NAME.test(name))
            throw new PlanError(`arm name '${name}' may hold only letters, digits and . _ @ + -`);
    if (new Set(names).size !== names.length)
        throw new PlanError("arm names must be unique");
    if (input.arms.filter((a) => a.role === "base").length > 1)
        throw new PlanError("a plan has at most one base arm");
    if (input.arms.filter((a) => a.role === "candidate").length > 1)
        throw new PlanError("more than one candidate arm is not supported yet (REQ-57); compare one candidate per run");
    const reasons = [];
    let binary = true;
    for (const primary of suite.primary) {
        const safety = primary.safetyMargin ?? 0;
        if (!(primary.margin < 1 && safety <= primary.margin))
            throw new PlanError(`primary measure '${primary.measure}': the margin must be below 1 and at least the safety margin (${primary.margin}, safety ${safety})`);
        const measure = input.measures.get(primary.measure);
        if (!measure)
            throw new PlanError(`primary measure '${primary.measure}' is not provided by any plugin`);
        // A measure Ichnaea computes is tested here, now, whatever its card says. A measure the
        // application computes carries the application's tester result on its card.
        const status = measure.card.computedBy === "ichnaea"
            ? (await testMeasure(measure)).status
            : measure.card.validation?.tester?.status;
        if (status !== "passed") {
            throw new PlanError(`primary measure '${primary.measure}' has no passing known-good and known-bad test; run 'ichnaea doctor' to see why`);
        }
        if (measure.card.composite === true)
            throw new PlanError(`primary measure '${primary.measure}' is a composite of other measures; report it as a secondary measure (REQ-34)`);
        if (measure.card.tier !== "primary")
            throw new PlanError(`primary measure '${primary.measure}' has a ${measure.card.tier} card; only a card of tier primary can decide`);
        if (measure.card.valueType !== "binary") {
            binary = false;
            reasons.push(`primary measure '${primary.measure}' has ${measure.card.valueType} values, which no validated method decides yet (decision 0008)`);
        }
        if (primary.marginStatus === "placeholder")
            reasons.push(`margins not registered: primary measure '${primary.measure}' has a placeholder margin (decision 0012)`);
    }
    const varies = [...new Set(input.varies ?? [])].toSorted();
    for (const key of varies)
        if (!FACTOR_KEY.test(key))
            throw new PlanError(`'${key}' is not a factor key; use model.<role>, parameter.<name>, prompt.<name> or factor.<name>`);
    if (varies.length > 0 && TRIGGER_VARIES[input.trigger] === null)
        throw new PlanError(`a ${input.trigger} trigger changes nothing in the system, so it cannot declare ${varies.join(", ")} as varied`);
    for (const id of suite.secondary ?? [])
        if (!input.measures.has(id))
            throw new PlanError(`secondary measure '${id}' is not provided by any plugin`);
    for (const id of suite.hardGates ?? [])
        if (!input.gates.has(id))
            throw new PlanError(`hard gate '${id}' is not provided by any plugin`);
    const arms = await Promise.all(input.arms.map(async (a) => ({
        name: a.name,
        role: a.role,
        identity: await configurationIdentity(a.configuration),
        configuration: a.configuration,
    })));
    if (!(arms.some((a) => a.role === "base") && arms.some((a) => a.role === "candidate")))
        reasons.push("the plan has no base and candidate arm to compare");
    if (suite.primary.length === 0)
        reasons.push("the suite declares no primary measure");
    if (suite.estimand === "sampled-cases")
        reasons.push("no sampled-cases method is validated yet (decision 0009)");
    // Trials per case and arm: the suite's count, or the largest `replicatesFor` entry that matches.
    const overrides = suite.replicatesFor ?? [];
    for (const o of overrides)
        if (!selectedCases.some((c) => c.slices?.[o.slice] === o.value))
            throw new PlanError(`replicatesFor ${o.slice}=${o.value} matches no selected case; check the slice name and value`);
    const trialsOf = (c) => Math.max(suite.replicates, ...overrides.filter((o) => c.slices?.[o.slice] === o.value).map((o) => o.replicates));
    const counts = selectedCases.map(trialsOf);
    // One trial per case and arm is validated for binary regression only (VALIDATION.md).
    const oneTrial = counts.every((n) => n === 1);
    if (suite.estimand === "fixed-cases" && Math.min(...counts) < 2 && !(oneTrial && binary))
        reasons.push("one trial per case and arm is outside the validated domain");
    if (selected.length < MIN_DECISION_CASES)
        reasons.push(`${selected.length} case(s); a decision is validated from ${MIN_DECISION_CASES} cases`);
    const trials = [];
    const planned = (c, entry, arm, replicate, batch) => ({
        id: `${c.id}/${arm.name}/r${replicate}`,
        case: c.id,
        ...(entry.family === undefined ? {} : { family: entry.family }),
        arm: arm.name,
        replicate,
        batch,
    });
    const seed = { algorithm: "mt19937", value: String(input.seed) };
    if (oneTrial) {
        // One pair per case, in the coin's order, so the plan's order is the run order. An arm that is
        // neither base nor candidate runs after the pair.
        const base = arms.find((a) => a.role === "base");
        const candidate = arms.find((a) => a.role === "candidate");
        for (const [i, entry] of selected.entries()) {
            const c = selectedCases[i];
            const pair = base && candidate
                ? (await candidateRunsFirst(seed, c.id))
                    ? [candidate, base]
                    : [base, candidate]
                : [];
            for (const arm of [...pair, ...arms.filter((a) => !pair.includes(a))])
                trials.push(planned(c, entry, arm, 0, i));
        }
    }
    else {
        for (let replicate = 0; replicate < Math.max(...counts); replicate++) {
            for (const [i, entry] of selected.entries()) {
                const c = selectedCases[i];
                if (replicate >= counts[i])
                    continue;
                // Alternating batches: replicate r runs every case under every arm before r + 1 (REQ-25).
                for (const [k, arm] of arms.entries())
                    trials.push(planned(c, entry, arm, replicate, replicate * arms.length + k));
            }
        }
    }
    if (new Set(trials.map((t) => t.id)).size !== trials.length)
        throw new PlanError("two planned trials share an ID; case IDs and arm names collide");
    const running = new Set(input.armsToRun ?? arms.map((a) => a.name));
    const worstCaseCalls = trials.filter((t) => running.has(t.arm)).length * suite.budget.callsPerTrial;
    const measures = await Promise.all([...suite.primary.map((p) => p.measure), ...(suite.secondary ?? [])].map(async (id) => {
        const card = input.measures.get(id).card;
        return { kind: "measure", id, version: card.version, digest: await digest(card) };
    }));
    return Plan.parse({
        schema: "ichnaea.plan/1",
        suite: suite.id,
        suiteVersion: suite.version,
        suiteDigest: await digest(suite),
        caseSet: input.caseSet.id,
        caseSetDigest: input.caseSet.digest,
        trigger: input.trigger,
        varies,
        mode: reasons.length === 0 ? "decision" : "estimate-only",
        modeReasons: reasons,
        estimand: suite.estimand,
        alpha: suite.alpha ?? 0.05,
        replicates: suite.replicates,
        arms,
        measures,
        primary: suite.primary,
        secondary: suite.secondary ?? [],
        hardGates: suite.hardGates ?? [],
        policy: suite.policy,
        power: [],
        budget: {
            worstCaseCalls,
            maxCalls: suite.budget.maxCalls,
            ...(input.monthlyRemaining === undefined ? {} : { monthlyRemaining: input.monthlyRemaining }),
        },
        trials,
        ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
        ...(input.aa === undefined ? {} : { aa: input.aa }),
        seed,
        createdAt: input.now,
        ichnaea: input.ichnaea,
    });
}
//# sourceMappingURL=planner.js.map