# 0020. Binary REGRESSION is validated at one trial per case, under record checks

- Status: Accepted
- Date: 2026-11-16

## Context

A suite that runs one trial per case and arm costs half of one at two trials. Until now the planner
made every such plan estimate-only, because the validated domain required at least 90% of case-arm
cells with 2 or more trials (decision 0009). The exact type-I study of the binary regression test at
one trial per case (VALIDATION.md, "One trial per case: the binary regression test") found no point
above its level, from 5 to 300 cases, at α and at the Holm levels α/2, α/3 and α/4. The study
assumes what the statistics cannot see: that a shock between the two trials of a case is shared by
both arms, so the records must show it, and A/A runs must show that the setup gives no false
REGRESSION. REQ-25 asks for this order and these times at one trial per case.

## Decision

For a binary primary measure under `fixed-cases`, at exactly one completed trial per arm in every
used case and at least 5 used cases:

1. **Statistics.** The 90% rule does not apply. `compareCounts` validates the `regression` result
   only when the caller states, as `oneTrial`, that its checks of the records passed, and adds the
   caller's limitations. Without it, the result names `ONE_TRIAL_NEEDS_CHECKS`. The
   `nonInferiority` result is never validated, with `NON_INFERIORITY_AT_ONE_TRIAL`. With the
   checks stated, a case without its pair is no limitation, because the caller counts it against
   coverage. Mixed one and two trials stay under the 90% rule.
2. **The order within each pair is random.** `candidateRunsFirst` in the contracts is the one coin:
   SHA-256 over the canonical JSON of `{ seed, case }`, the lowest bit of the first byte. The
   planner lists each case's pair in its order, so the plan's order is the run order, and `batch`
   numbers the pairs. `decide` recomputes it, and a case whose trials ran in the other order is
   unpaired. A binary plan at one trial per case is a decision plan. A non-binary primary measure
   or mixed counts keep it estimate-only.
3. **Adjacency by start rank.** Every trial that ran records `startedAt` and `endedAt`, or the result
   is not validated ("the records do not show when the arms ran"). c is the largest number of
   overlapping trials in the records. A case whose two trials are more than 2c − 1 start ranks apart
   is unpaired. There is no fixed time window.
4. **Per case, not per run.** An unpaired case is excluded and counts against coverage, exactly as
   a missing trial does. The coverage floor and the sensitivity analysis (decision 0010) decide.
5. **The schedule and the A/A precondition.** The plan gains two additive fields. `schedule`
   states the concurrency and the endpoint; a decision at one trial per case needs it. `aa` cites
   A/A decisions by run and decision digest (`ichnaea import --aa <run>`). `decide` takes the cited
   records, which the CLI loads from the store, and requires at least two distinct ones that pass
   the eight checks in VALIDATION.md. An A/A plan waives only its own A/A precondition.
6. **What `decide` cannot see** is stated, not checked: it trusts the recorded timestamps, and an
   importer that merges several hosts states its clock source; a provider-side change behind the
   same model ID is not detected; an A/A REGRESSION is never discarded, and blocks one trial per
   case for that suite, model and schedule until its cause is found and two later, consecutive A/A
   decisions are clean.

This record implements REQ-25 at one trial per case and narrows decision 0009 for it.

## Evidence

- The type-I study: `validation/binary-one-trial.tsv` and its sidecar, written by
  `scripts/stats/study-binary-one-trial.ts`. `test/stats-studies/binary-one-trial.test.ts` checks that the
  rejection region equals the exact McNemar test's at every n up to 300 and every level, that the
  dynamic programme equals enumeration through `compareCounts`, and recomputes every listed worst
  structure. This change does not change any p-value of `compareCounts`, only its validity results,
  and that test still passes.
- `test/stats/one-trial-domain.test.ts`: regression at one trial per case with and without
  `oneTrial`; non-inferiority never validated; mixed one and two trials unchanged.
- `test/core/one-trial-plan.test.ts`: the coin is the stated hash bit and is fair; the plan's order
  follows it; the batches are pair indices; a binary plan decides and a non-binary one does not.
- `test/decide/one-trial.test.ts`: an out-of-order case and a case too many ranks apart are unpaired
  and count against coverage; c is computed from the overlaps (at c = 1 and c = 3); missing times
  and a missing schedule leave the result not validated; a run with two clean A/A decisions
  validates REGRESSION and a real drop gives REGRESSION; each A/A check, and one A/A decision alone,
  leaves the result not validated with its named reason.
- `examples/support-assistant/test/one-trial.test.ts`: two A/A runs are imported and decided, the
  change cites them with `--aa`, and `decide` and `report` load them from the store.
- `scripts/decide/mutants.ts`: 18 mutants of the coin, the order and rank rules, the A/A checks and
  the one-trial domain, each killed.

## Consequences

- A binary suite can run one trial per case and block a real drop. It never passes at one trial per
  case: an unchanged candidate is INCONCLUSIVE.
- A team that wants this runs and decides at least two A/A runs of the suite at one trial per case,
  on the same model and schedule, and cites them. Its importer must record when every trial started
  and ended.
- Without a REGRESSION result at one trial per case, the decision says which check failed. A
  decision at one trial per case never claims "beyond run-to-run noise", because no case has two
  trials in an arm (decision 0016).
- The owner rule on A/A REGRESSIONs is a practice that `decide` cannot enforce: it does not know
  which A/A decisions are the most recent.
