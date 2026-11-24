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
4. **INCONCLUSIVE** for statistical comparisons. A within-run test that rejects after Holm
   adjustment gives `DROP_IN_THESE_RUNS_ONLY`. Unavailable or unvalidated tests contribute p = 1
   to the Holm family. Set `policy.onRunDrop: "block"` to stop CI for this reason. If omitted,
   `policy.onInconclusive` applies.

A statistical pass needs randomized blocks and a validated margin floor. These comparisons still
record their estimates, bounds and validity. When a primary measure misses a trial in either arm,
Ichnaea checks the drop against a completion in which a missing candidate trial passes and a
missing base trial fails.

**One trial per case and arm** can give a drop within these runs if the checks of decision 0020 pass. `decide` checks the
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
check the type-I error of the within-run test under independent trials. Run it with
`pnpm --filter @tumaet/ichnaea run test:sim:decide`.
