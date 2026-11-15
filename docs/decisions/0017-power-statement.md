# 0017 The power statement of a decision, with or without the decide plugin

- Status: Accepted
- Date: 2026-11-15

## Context

Every decision carries a power statement: per primary measure, the minimum detectable effect
(MDE). The plan's statement is computed before any call. It says what a run of the plan can detect
at best, so that an underpowered plan runs estimate-only before any budget is spent. After a run,
a run-time statement simulates the MDE from the base arm's per-case rates in that run. It helps a
reader understand a result without a verdict.

Decision 0014 set these rules. It left one gap. The decide plugin adds the plan's statement when
the plan is made. A program that calls `decide()` as a library, with a plan made without the
plugin, has a plan with `power: []`. Its decision carried an empty planning statement, which says
nothing and does not say why. The CLI and the presets always load the plugin, so they do not have
this gap.

## Decision

- A decision carries the plan's power statement unchanged, as `power.planning`, and one run-time
  entry per primary measure, as `power.run`.
- When the plan carries no statement and has a primary measure, `decide()` computes the statement
  from the plan with the function that the plugin uses, `planningPower`. The statement is a
  function of the plan alone, so it is the statement that the plugin would have added.
- A decision never carries an empty planning statement when the plan has a primary measure.
- Every entry is either computed, with its numbers and the assumption behind them, or not
  computed, with its reason. It never holds a number that is not one. The reasons are:
  - "run invalid"
  - "no applicable case with a base value"
  - "fixed-cases needs at least 2 trials per case and arm"
  - "the plan carries no planning statement, and its margin is refused": the plan has no
    statement, and `planningPower` refuses its margin (decision 0012). The entry also carries the
    refusal text of `planningPower` as `refusal`. Only this entry has a `refusal`.
  - "the plan carries no planning statement, and none can be computed from it": the plan has no
    statement, and `planningPower` gives none and refuses nothing. That is the case for a plan
    with primary measures but no planned trial in the base arm.
- These two reasons name only what `decide()` observes. They do not say how the plan was made: a
  plan that the plugin made can also have no statement.
- A line that prints the refused reason prints it as "<reason>: <refusal>".
- An INVALID decision runs no power simulation. Each of its run-time entries says "run invalid".
- Only the plan's statement may switch a plan to estimate-only, and only before any call. A
  statement that `decide()` computes after the calls has the same `floor` and `decidable`, but it
  never changes the mode of the decision.
- A run-time estimate never changes the verdict or the mode of its own run. A run-time entry says
  whether the margin is within reach (`decidable`) to explain the result, and nothing reads it.
- Estimate-only and INCONCLUSIVE decisions keep the run-time estimate, because there it explains
  why there was no verdict.
- A later plan that takes its noise assumption from an earlier run reads only computed run-time
  entries. An INVALID decision has none, so its noise is never reused. No path takes a noise
  assumption from records yet. The record carries what such a path needs to refuse an INVALID run.

This record supersedes decision 0014.

## Evidence

- An INVALID decision used to carry a simulated MDE, computed from a base arm that could be below
  its coverage floor.
- A run with one trial per case carried `mde: null` and `floor: null` in its record.
- A plan made without the plugin gave a decision with `planning: []`.
- `packages/decide/test/power.test.ts` pins the rule:
  - "a plan made without the decide plugin gets its planning statement from the plan": the
    decision's statement equals `planningPower` of the plan. A plan whose planning floor is out of
    reach gets `decidable: false`, and its decision stays in decision mode.
  - "a plan without a statement whose margin is refused carries the refusal": a margin of 0.35,
    above the validated ceiling, gives the refused reason, and `refusal` equals the refusal text of
    `planningPower`.
  - "a plan without a statement that plans no base-arm trial says none can be computed": the
    entry gives "the plan carries no planning statement, and none can be computed from it".
  - "no decision carries an empty planning statement, with or without the plugin": nine scenarios
    give one entry per primary measure. Each is decided without the plugin's statement, and with it
    where the plugin accepts the plan.
- `packages/decide/scripts/mutants.ts` has four mutants that the tests kill: "decide keeps an
  empty planning statement", "planning: the not-computed entries dropped", "planning: the refusal
  text dropped" and "planning: the refused reason used for an uncomputable plan".

## Consequences

- The power statement has two more reasons for an entry that was not computed. A reader branches
  on `computed`, and reads `refusal` only for the refused reason.
- An INVALID decision is faster: it skips 1,000 simulations per primary measure.
- A library caller gets the same planning statement as the CLI. It does not get the plugin's
  refusal or its switch to estimate-only, because those apply before any call. A caller that wants
  them makes the plan with the plugin.
