# @hephaestus-build/ichnaea-decide

The decision rule of Ichnaea, as the `decide` plugin and the `decide()` function.

A run verdict is reached in this order (decision 0011):

1. **INVALID** when the records fail a check. Examples: a run of another plan, records that
   contradict themselves, a budget overrun, or coverage below the floor. Arms that differ beyond
   what the trigger varies and the plan declares are also INVALID. INVALID always blocks.
2. **REGRESSION** when a hard gate failed, in either mode.
3. **No verdict** when the plan is estimate-only or the run is exploratory. Every difference still
   has its interval.
4. Otherwise, per primary measure:
   - NON-INFERIOR when the one-sided bound clears the margin less its safety margin, each measure
     at the unadjusted level.
   - REGRESSION when the regression test rejects after Holm across the validated comparisons.
   - INCONCLUSIVE otherwise.

   The run is PASS only when every primary measure is non-inferior.

Whenever a primary measure misses a trial in either arm, each verdict is tested against the
imputation that works against it. A verdict that this changes becomes INCONCLUSIVE (decision 0010).

The plugin refuses a plan whose margin, less its safety margin, lies outside the validated
margins of the statistics package (decision 0012). It adds the plan's planning power statement.
Each decision carries that statement unchanged, and a run-time statement that never changes the
verdict (decision 0014).

`decidePrimaries` is the per-measure rule on counts alone. `test/req51.sim.test.ts` uses it to
show that the rate of false REGRESSION verdicts stays at or below α. Run it with
`pnpm --filter ./packages/decide run test:sim`.
