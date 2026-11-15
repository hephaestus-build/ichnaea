# 0012 Margins: registered, placeholder, and the validated range

- Status: Accepted
- Date: 2026-11-15

## Context

A non-inferiority margin is the smallest drop that matters to the owner of a measure. That is a
judgement about the product, not about noise. Two things can make a margin unfit for a verdict:

- It may be a placeholder that nobody has registered yet.
- It may lie outside the margins for which the fixed-cases interval is validated.

Below the floor, the lower bound can undercover when most cases always pass and a few noisy cases
offset small drops. Above the ceiling, the validation studies do not reach. A margin of 0 is not a
non-inferiority test at all.

## Decision

- Every primary measure of a suite declares `marginStatus`: `registered` or `placeholder`.
- **Placeholder.** A placeholder margin gives no verdict.
  - The planner runs the plan estimate-only, with the reason "margins not registered".
  - A plan in decision mode with a placeholder margin is INVALID at decision time.
- **Registered.** The measure's owner registers the margin in the suite, with a reason, before any
  candidate comparison uses it. A margin is never tuned so that a run passes.
- **The validated range.** The range runs from `VALIDATED_MARGIN_FLOOR` to
  `VALIDATED_MARGIN_CEILING`. The statistics package exports both, and the code reads them, never
  a copy.
  - The range applies to the effective margin: the declared margin less its safety margin. That is
    what the test uses, and what `compareCounts` receives as `margin`.
  - The planner refuses a primary measure whose effective margin lies outside the range. The
    refusal names the declared margin, the safety margin, and the bound that is broken.
  - Every declared margin is checked, a placeholder too, so a margin that could never decide is
    refused at plan time, not first at the run.
  - The range belongs to the `fixed-cases` non-inferiority interval only. Under `sampled-cases`,
    or any other method, it does not apply: that method states its own validated domain.
- A margin below the floor, and so a margin of 0, is never a non-inferiority test. A claim that a
  candidate is better (a lower bound above 0) is descriptive and never validated. The decision
  rule makes no such claim.
- A comparison that reaches the statistics with an effective margin outside the range anyway has a
  non-inferiority result that is not validated there. It cannot give NON-INFERIOR (decision 0015).

## Evidence

- The values of both constants, and the studies behind them, are in `packages/stats/VALIDATION.md`
  ("Heterogeneous effects").
- A declared margin of 0.10 with a safety margin of 0.06 is tested at 0.04. With a floor of 0.05,
  the planner refuses it.

## Consequences

- A suite whose margins are not yet registered runs estimate-only. It reports estimates and
  intervals, and says why it gives no verdict.
- When the statistics layer moves a bound, plans with margins near it are refused at plan time,
  before any call.
- An application that wants a verdict registers its margins. Before that, it shows that the
  minimum detectable effect at its planned trials is at most the margin.
