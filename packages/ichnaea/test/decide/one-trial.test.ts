// REQ-25, REQ-50, VALIDATION.md "Conditions for a validated result at one trial per case": the
// regression result of a binary primary measure at one trial per case and arm is validated only
// when every pair ran in the coin's order and adjacent in start rank, the records show when every
// trial ran, the plan states its schedule, and at least two clean A/A decisions are cited.
import { describe, expect, it } from "vitest";

import type { Decision } from "../../src/contracts/index.ts";
import type { AaEvidence } from "../../src/decide/index.ts";
import { NON_INFERIORITY_AT_ONE_TRIAL } from "../../src/stats/index.ts";
import {
  aaRun,
  cite,
  cleanAa,
  decideAt,
  moved,
  ONE,
  SCHEDULE,
  timed,
} from "./support/one-trial.ts";
import { configuration, type ScenarioOptions, scenario } from "./support/scenario.ts";

const NO_TIMES = "the records do not show when the arms ran";

/** Decides a run of `ONE` (with changes) that cites `aa`, timed by `time`. */
async function decideOne(
  aa: readonly AaEvidence[],
  over: Partial<ScenarioOptions> = {},
  time: (s: Awaited<ReturnType<typeof scenario>>) => Awaited<ReturnType<typeof scenario>> = (s) =>
    timed(s),
  given: readonly AaEvidence[] = aa,
): Promise<Decision> {
  const s = time(await scenario({ ...ONE, aa: await cite(aa), ...over }));
  return decideAt(s, given);
}
const comparison = (d: Decision) => d.measures[0]?.comparisons[0];
const regression = (d: Decision) => comparison(d)?.regression;
const notes = (d: Decision): string => d.measures[0]?.notes.join("\n") ?? "";

// [A1, B1, A2, B2, ...]: the first two cases are 2 ranks apart.
const crossed = (s: Awaited<ReturnType<typeof scenario>>, c: number) => timed(s, c, moved(s, 1, 2));
// [A1, B1, B2, C1, C2, D1, A2, D2, ...]: case A is 6 ranks apart and case D 2.
const far = (s: Awaited<ReturnType<typeof scenario>>, c: number) => timed(s, c, moved(s, 1, 6));

// A sequential runner: each trial ends exactly when the next starts. Half-open [start, end) intervals do not
// overlap there; closed ones would count 2 and loosen the rank rule to 3 ranks.
const touching = (s: Awaited<ReturnType<typeof scenario>>) => {
  const t = crossed(s, 1);
  return {
    ...t,
    trials: t.trials.map((trial) =>
      trial.startedAt === undefined
        ? trial
        : {
            ...trial,
            endedAt: new Date(Date.parse(trial.startedAt) + 1000).toISOString(),
          },
    ),
  };
};

const limitations = async (
  evidence: readonly AaEvidence[],
  given: readonly AaEvidence[] = evidence,
): Promise<readonly string[]> => {
  const d = await decideOne(evidence, {}, (s) => timed(s), given);
  const r = regression(d);
  expect(r?.validated).toBe(false);
  return r?.limitations ?? [];
};

const modelB = (c: ReturnType<typeof configuration>) => ({
  ...c,
  models: [{ ...c.models[0]!, id: { value: "model-b", status: "pinned" as const } }],
});

describe("a run at one trial per case and arm", async () => {
  const aa = await cleanAa();

  it("reports a detectable within-run drop after two clean A/A decisions", async () => {
    const same = await decideOne(aa);
    expect(same.mode).toBe("decision");
    expect(regression(same)).toEqual({ validated: true, limitations: [] });
    expect(comparison(same)?.nonInferiority.limitations).toContain(NON_INFERIORITY_AT_ONE_TRIAL);
    // No PASS at one trial per case: no drop is INCONCLUSIVE, never NON-INFERIOR.
    expect(same.measures[0]?.verdict).toBe("INCONCLUSIVE");
    expect(same.verdict).toBe("INCONCLUSIVE");
    // 8 of 20 cases fail under the candidate: exact McNemar p = 0.5^8.
    const drop = await decideOne(aa, { candidate: (i) => (i < 8 ? 0 : 1) });
    expect(regression(drop)?.validated).toBe(true);
    expect(drop.measures[0]?.verdict).toBe("INCONCLUSIVE");
    expect(drop.reasonCode).toBe("DROP_IN_THESE_RUNS_ONLY");
    expect(drop.reason).toBe("Measure app/correct dropped in these runs.");
    expect(drop.scope).toBe("on these 20 cases");
    expect(drop.limitations).toContain(
      "Decide trusts the trial timestamps as recorded. An importer that merges several hosts states its clock source.",
    );
  });

  it("an A/A plan waives only its own A/A precondition", async () => {
    expect(aa[0]?.decision.measures[0]?.comparisons[0]?.regression).toEqual({
      validated: true,
      limitations: [],
    });
    // Its other conditions still hold: without timestamps, its regression is not validated.
    const s = await scenario({
      ...ONE,
      runId: "aa-x",
      candidateConfig: () => configuration("model-a", "a1"),
    });
    const d = await decideAt(s);
    expect(regression(d)).toEqual({ validated: false, limitations: [NO_TIMES] });
  });
});

describe("the order within each pair", async () => {
  const aa = await cleanAa();

  it("a case whose trials ran against the coin is unpaired and counts against coverage", async () => {
    // Positions 6 and 7 hold the pair of case-003; swapping them reverses its order only.
    const d = await decideOne(aa, {}, (s) => {
      expect(s.plan.trials[6]?.case).toBe("case-003");
      expect(s.plan.trials[7]?.case).toBe("case-003");
      return timed(s, 1, moved(s, 7, 6));
    });
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(regression(d)?.validated).toBe(true);
    expect(d.measures[0]?.coverage).toBe(0.95);
    expect(d.measures[0]?.arms.map((a) => a.availability.missing)).toEqual([1, 1]);
    expect(notes(d)).toContain("1 case(s) lost their pair");
    // The sensitivity analysis covers the lost pair.
    expect(d.missingness.sensitivity).not.toBe("not-needed");
  });

  it("too many lost pairs fall below the coverage floor, and the run is INVALID", async () => {
    const d = await decideOne(aa, {}, (s) => {
      let order = s.plan.trials.map((t) => t.id as string);
      for (const p of [0, 2, 4]) {
        const ids = [...order];
        [ids[p], ids[p + 1]] = [ids[p + 1] as string, ids[p] as string];
        order = ids;
      }
      return timed(s, 1, order);
    });
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toBe("measure 'app/correct': coverage 85.0% is below its floor of 90.0%");
  });
});

describe("adjacency by start rank, at the concurrency the records show", async () => {
  const aa = await cleanAa();

  it("at concurrency 1, a case more than 1 rank apart is unpaired", async () => {
    const d = await decideOne(aa, {}, (s) => crossed(s, 1));
    expect(notes(d)).toContain(
      "2 case(s) lost their pair: their trials ran against the planned order or more than 1 start rank(s) apart (concurrency 1 in the records), so they count as missing",
    );
    expect(d.measures[0]?.coverage).toBe(0.9);
    const both = await decideOne(aa, {}, (s) => far(s, 1));
    expect(notes(both)).toContain("2 case(s) lost their pair");
  });

  it("reads a sequential runner whose trials touch end to start as concurrency 1", async () => {
    const d = await decideOne(aa, {}, touching);
    expect(notes(d)).toContain(
      "2 case(s) lost their pair: their trials ran against the planned order or more than 1 start rank(s) apart (concurrency 1 in the records), so they count as missing",
    );
  });

  it("at concurrency 3, computed from the overlaps, pairs up to 5 ranks apart hold", async () => {
    const d = await decideOne(aa, {}, (s) => crossed(s, 3));
    expect(notes(d)).not.toContain("lost their pair");
    expect(d.measures[0]?.coverage).toBe(1);
    expect(regression(d)?.validated).toBe(true);
    const far3 = await decideOne(aa, {}, (s) => far(s, 3));
    expect(notes(far3)).toContain(
      "1 case(s) lost their pair: their trials ran against the planned order or more than 5 start rank(s) apart (concurrency 3 in the records), so they count as missing",
    );
  });

  it("a trial without both timestamps leaves regression not validated, with the reason", async () => {
    const drop = { candidate: (i: number) => (i < 8 ? 0 : 1) };
    for (const missing of ["startedAt", "endedAt"] as const) {
      const d = await decideOne(aa, drop, (s) => {
        const t = timed(s);
        const [first, ...rest] = t.trials;
        const { [missing]: _gone, ...kept } = first as NonNullable<typeof first>;
        return { ...t, trials: [kept, ...rest] };
      });
      expect(regression(d)).toEqual({ validated: false, limitations: [NO_TIMES] });
      expect(d.measures[0]?.verdict).toBe("INCONCLUSIVE");
    }
  });

  it("a plan without a schedule leaves regression not validated, with the reason", async () => {
    const s = timed(await scenario({ ...ONE, schedule: undefined, aa: await cite(aa) }));
    const d = await decideAt(s, aa);
    expect(regression(d)?.limitations).toContain(
      "the plan states no schedule (concurrency and endpoint), which one trial per case needs",
    );
  });
});

describe("the A/A precondition", async () => {
  const aa = await cleanAa();
  const [first, second] = aa as [AaEvidence, AaEvidence];

  it("one A/A decision is not enough, nor one cited twice", async () => {
    expect(await limitations([first])).toEqual([
      "one trial per case needs at least two A/A decisions, and the plan cites 1",
    ]);
    expect(await limitations([first, first])).toEqual([
      "one trial per case needs at least two A/A decisions, and the plan cites 1",
    ]);
    expect(await limitations([])).toEqual([
      "one trial per case needs at least two A/A decisions, and the plan cites 0",
    ]);
  });

  it("a cited decision that is not given is named", async () => {
    expect(await limitations(aa, [first])).toEqual([
      "A/A run 'aa-2': no decision record was given",
    ]);
  });

  it("1: the decision must match its cited digest, the given plan and the given run", async () => {
    const changed = { ...second, decision: { ...second.decision, reason: "edited" } };
    expect(await limitations([first, second], [first, changed])).toEqual([
      "A/A run 'aa-2': its decision record does not match the cited digest",
    ]);
    expect(await limitations([first, second], [first, { ...second, plan: first.plan }])).toEqual([
      "A/A run 'aa-2': its decision does not belong to the given plan",
    ]);
    expect(await limitations([first, second], [first, { ...second, run: first.run }])).toEqual([
      "A/A run 'aa-2': its decision does not belong to the given run",
    ]);
  });

  it("2: both arms must be one configuration", async () => {
    // The candidate keeps its own commit: the arms differ.
    const ab = await aaRun("aa-2", { candidateConfig: (c) => c });
    expect(await limitations([first, ab])).toContain(
      "A/A run 'aa-2': its arms are not one configuration, so it is not an A/A comparison",
    );
  });

  it("3: it must run one trial per case and arm", async () => {
    const two = await aaRun("aa-2", { replicates: 2 });
    expect(await limitations([first, two])).toContain(
      "A/A run 'aa-2': it does not run one trial per case and arm",
    );
  });

  it("4: it must run this plan's suite", async () => {
    const other = await aaRun("aa-2", { margin: 0.15 });
    expect(await limitations([first, other])).toEqual(["A/A run 'aa-2': it ran another suite"]);
  });

  it("5: its own regression results must be validated", async () => {
    const s = await scenario({
      ...ONE,
      runId: "aa-2",
      candidateConfig: () => configuration("model-a", "a1"),
    });
    const untimed: AaEvidence = { decision: await decideAt(s), plan: s.plan, run: s.run };
    expect(await limitations([first, untimed])).toEqual([
      "A/A run 'aa-2': its regression results are not validated",
    ]);
  });

  it("6: no primary measure in it may detect a drop", async () => {
    const regressed = await aaRun("aa-2", { candidate: (i) => (i < 8 ? 0 : 1) });
    expect(regressed.decision.reasonCode).toBe("DROP_IN_THESE_RUNS_ONLY");
    expect(await limitations([first, regressed])).toEqual([
      "A/A run 'aa-2': a primary measure dropped in the A/A run",
    ]);
  });

  it("8: it must match this plan's model and schedule", async () => {
    const other = await aaRun("aa-2", {
      baseConfig: modelB,
      candidateConfig: () => modelB(configuration("model-a", "a1")),
    });
    expect(await limitations([first, other])).toEqual([
      "A/A run 'aa-2': its model differs from this plan's base arm",
    ]);
    const wider = await aaRun("aa-2", { schedule: { ...SCHEDULE, concurrency: 2 } });
    expect(await limitations([first, wider])).toEqual([
      "A/A run 'aa-2': its schedule differs from this plan's",
    ]);
    const elsewhere = await aaRun("aa-2", { schedule: { ...SCHEDULE, endpoint: "other" } });
    expect(await limitations([first, elsewhere])).toEqual([
      "A/A run 'aa-2': its schedule differs from this plan's",
    ]);
  });

  it("8: the base configuration's own digest need not match, only its model", async () => {
    const otherCommit = await aaRun("aa-2", {
      baseConfig: () => configuration("model-a", "c3"),
      candidateConfig: () => configuration("model-a", "c3"),
    });
    const d = await decideOne([first, otherCommit]);
    expect(regression(d)).toEqual({ validated: true, limitations: [] });
  });
});
