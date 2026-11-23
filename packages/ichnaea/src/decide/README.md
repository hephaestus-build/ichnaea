# Decision rule: `@tumaet/ichnaea`

The decision rule of Ichnaea, as the `decide` plugin and the `decide()` function.
`compare(plan, records, { decidedAt })` decides a plan's run from its records. Like `decide`, it is
synchronous and pure: the same records and `decidedAt` give the same decision, byte for byte.

A run verdict is reached in this order (decision 0011):

1. **INVALID** when the records fail a check. Examples: a run of another plan, records that
   contradict themselves, a budget overrun, or coverage below the floor. Arms that differ beyond
   what the trigger varies and the plan declares are also INVALID. INVALID always blocks.
2. **REGRESSION** when a hard gate failed, in either mode.
3. **No verdict** when the plan is estimate-only or the run is exploratory. Each difference still
   has the interval of the plan's estimand where the data supports a comparison; otherwise its notes
   say why it has none.
4. Otherwise, per primary measure (decision 0015):
   - NON-INFERIOR when both results of the comparison, `regression` and `nonInferiority`, are
     validated, and the one-sided bound clears the margin less its safety margin. Each measure is
     tested at the unadjusted level.
   - REGRESSION when the regression result is validated and the regression test rejects after Holm
     across the primary measures declared in the plan. Unavailable or unvalidated tests count as p = 1.
   - INCONCLUSIVE otherwise, with the reason.

   The run is PASS only when every primary measure is non-inferior.

**No run passes yet.** The statistics have not set the validated margin floor, so no
non-inferiority result is validated. A real drop still gives REGRESSION. A candidate that does not
regress gives INCONCLUSIVE, and the reason names the cause of each primary measure. When the lower
bound does not clear the margin, the cases cannot tell yet, and the floor is named as well. When
the bound clears the margin, only the floor stands in the way. When every measure has that second
cause, the reason says that no candidate can PASS until the floor is set (`FLOOR_NOT_SET_REASON`).
The reason says "beyond run-to-run noise" only where the scope sentence does: under `fixed-cases`,
when every compared case has at least 2 completed trials in each arm (decision 0016).

Whenever a primary measure misses a trial in either arm, each verdict is tested against the
imputation that works against it. A verdict that this changes becomes INCONCLUSIVE (decision 0010).

**One trial per case and arm** can give REGRESSION, never PASS (decision 0020). `decide` checks the
records first. A case whose two trials ran against the plan's order, or more than 2c − 1 start ranks
apart (c is the largest number of trials the records show running at once), is unpaired: it counts
as missing. Every trial that ran must record when it started and ended, the plan must state its
schedule, and it must cite at least two clean A/A decisions of the same suite, model and schedule.
`ichnaea decide` and `ichnaea report` load the cited decisions from the store. Each check that fails
is a limitation of the regression result. VALIDATION.md in the statistics lists the checks.

The plugin refuses a plan whose margin, less its safety margin, lies outside the validated
margins of the statistics (decision 0012). It adds the planning power statement to every
plan, an estimate-only plan too. Without the plugin, a plan has no power statement, and
`ichnaea import` says so.
Each decision carries that statement unchanged, and a run-time statement that never changes the
verdict (decision 0017). When a library caller decides a plan that has no statement, `decide()`
computes it from the plan with `planningPower`, the plugin's own function. It does not switch the
plan to estimate-only. When `planningPower` refuses the margin, each entry says "the plan carries
no planning statement, and its margin is refused", and carries the refusal text as `refusal`. When
it computes nothing and refuses nothing, each entry says "the plan carries no planning statement,
and none can be computed from it".

`decidePrimaries` is the per-measure rule on counts alone. `test/decide/req51.sim.test.ts` uses it to
show that the rate of false REGRESSION verdicts stays at or below α. Run it with
`pnpm --filter @tumaet/ichnaea run test:sim:decide`.
