# 0014 The power statement of a decision

- Status: Superseded by 0017
- Date: 2026-11-15

## Context

Every decision carries a power statement: per primary measure, the minimum detectable effect
(MDE). The plan's statement is computed before any call. It says what a run of the plan can detect
at best, so that an underpowered plan runs estimate-only before any budget is spent. After a run,
a run-time statement simulates the MDE from the base arm's per-case rates in that run. It helps a
reader understand a result without a verdict.

Three things went wrong. An INVALID run still ran the simulation, although it draws no inference
and its base arm may be the broken part. An entry that could not be computed held NaN, which
serialises as null and reads like a gap. Nothing stated that a run-time estimate must not decide
anything.

## Decision

- A decision carries the plan's power statement unchanged, as `power.planning`, and one run-time
  entry per primary measure, as `power.run`.
- Every entry is either computed, with its numbers and the assumption behind them, or not
  computed, with its reason. It never holds a number that is not one. The reasons are:
  - "run invalid"
  - "no applicable case with a base value"
  - "fixed-cases needs at least 2 trials per case and arm"
- An INVALID decision runs no power simulation. Each of its run-time entries says "run invalid".
- A run-time estimate never changes the verdict or the mode of its own run. Only the plan's
  statement may switch a plan to estimate-only, and only before any call. A run-time entry says
  whether the margin is within reach (`decidable`) to explain the result, and nothing reads it.
- Estimate-only and INCONCLUSIVE decisions keep the run-time estimate, because there it explains
  why there was no verdict.
- A later plan that takes its noise assumption from an earlier run reads only computed run-time
  entries. An INVALID decision has none, so its noise is never reused. No path takes a noise
  assumption from records yet. The record carries what such a path needs to refuse an INVALID run.

## Evidence

- An INVALID decision used to carry a simulated MDE, computed from a base arm that could be below
  its coverage floor.
- A run with one trial per case carried `mde: null` and `floor: null` in its record.

## Consequences

- The power statement changed shape in the decision contract. A reader branches on `computed`.
- An INVALID decision is faster: it skips 1,000 simulations per primary measure.
