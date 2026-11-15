# @hephaestus-build/ichnaea-core

## 0.1.0

### Minor Changes

- 78747de: First end-to-end slice: import another runner's results, decide, report.
  
  `core`:
  
  - **Plugin host.** Seven lifecycle hooks, and measure cards validated at load. A primary measure needs a primary card, and is never a composite. Egress is denied by default. Only the plugin that the configuration names as `governance` can open it.
  - **Store and ledger.** A file store writes each run once and atomically. It refuses duplicate records, and reads a missing records file as a damaged run. A monthly call ledger takes over a lock left by a crashed run. A ledger line without a `run` and a non-negative whole number of `calls` stops the booking with an error that names the file and the line, so a corrupt line can never lower the month's total; other fields on a line are ignored.
  - **Planner.** It lists every trial before any call. A suite can give the cases of one slice more trials (`replicatesFor`). A placeholder margin, and anything else no validated method can decide, runs estimate-only with its reasons.
  - **Triggers.** Each trigger declares what the arms may vary (`TRIGGER_VARIES`). Anything else a change varies is declared with `ichnaea import --vary <factor key>`. `ichnaea help` lists each trigger and what it varies.
  - **Node.** The packages need Node 22.18 or later, the first version that loads `ichnaea.config.ts` without a flag. On an older Node, the CLI says so and exits with 2.
  - **CLI.** `ichnaea --version` and `-v` print the version. A missing `ichnaea.config.ts` gives a short message and exit code 2, not a module error.
  - **Import.** `ichnaea import` reads another runner's results and makes no model calls. A completed record without captured output becomes an infrastructure failure (`NOT_CAPTURED`). A failed trial that carries a passing value is refused. Import prints the plan's power statement, or says that the configuration has no plugin that states one.
  
  `decide`, in order:
  
  - **INVALID** when the records fail a check, and it always blocks. That covers a run of another plan, records that contradict themselves, and arms that differ beyond what the trigger varies and the plan declares, in configuration or in what the trials report. For a difference in configuration, the reason names the `--trigger` values and the `--vary` flag that allow it.
  - **REGRESSION** when a hard gate failed, in either mode.
  - **No verdict** for an estimate-only plan or an exploratory run.
  - **Statistics** otherwise. Non-inferiority on every primary measure at the unadjusted level gives PASS, and it needs both validity results of the comparison. REGRESSION needs the regression result validated, and uses Holm across those comparisons. System failures are failed trials, whatever value they carry.
  - **No PASS yet.** The validated margin floor is not set, so no non-inferiority result is validated and no run passes. A real drop still gives REGRESSION. A candidate that does not regress gives INCONCLUSIVE, and the reason names each primary measure's cause: the cases cannot tell yet, or only the unset floor stands in the way. When every measure has the second cause, `decide` prints: "No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set." The reason names missing trials only for a measure that misses them.
  - **Sensitivity analysis.** Whenever a primary measure misses a trial in either arm, each verdict is tested against the imputation that works against it. A verdict that changes becomes INCONCLUSIVE, and the decision shows both results.
  - **Margins.** The plugin refuses a margin, less its safety margin, outside the validated margins of `stats`, placeholders too.
  - **Power statement.** Every plan carries a planning power statement, an estimate-only plan too, and each decision carries it unchanged, with a run-time one. When you call `decide()` with a plan made without `decidePlugin()`, it computes the planning statement from the plan, so a decision never carries an empty one. An INVALID decision computes no run-time estimate, and no run-time estimate changes a verdict. An entry that was not computed says why. When the plan carries no statement and `planningPower` gives none, each entry says that the margin is refused, with the refusal text, or that no statement can be computed from the plan.
  - **Scope.** The scope sentence and the REGRESSION reason come from the records: the cases the primary measures compare, and "beyond run-to-run noise" only under `fixed-cases` when every compared case has at least 2 trials in each arm.
  - **Intervals.** A difference of a secondary or estimate-only measure carries the interval of the plan's estimand, with both validity results, where the data supports a comparison. Where it does not, the difference has no interval, and its notes say why.
  
  `report`: one view model renders a Markdown CI summary, with every value escaped, and a static HTML report. A lower bound whose non-inferiority result is not validated is labelled "not validated". Each difference sits on an axis centred at 0. A check first confirms that the decision recomputes from the stored records. A lint finds a rate or a difference without its interval. Verdict colours come from the Okabe–Ito palette.
  
  Contracts:
  
  - **Suites.** Suites gain `replicatesFor`, and each primary measure a `marginStatus` (`registered` or `placeholder`).
  - **Plans.** Plans record `varies`, why they are estimate-only, and each planned trial's family.
  - **Measure cards.** Cards can mark a `composite`.
  - **Power entries.** An entry is computed, with its numbers, or not computed, with its reason. An entry whose margin is refused also carries the refusal text, as `refusal`. `notComputedReason` prints the reason of an entry, with the refusal where there is one.
  - **Decisions.** Decisions gain `scope`, `power.planning` and `power.run`, and each measure's sensitivity results. Comparisons name their regression method and carry two validity results, `regression` and `nonInferiority`, each `{ validated, limitations }`; sensitivity results carry both too.
  - **CI policy.** A CI policy has no action for INVALID.

### Patch Changes

- Updated dependencies [14c1f8c]
- Updated dependencies [78747de]
- Updated dependencies [78747de]
  - @hephaestus-build/ichnaea-contracts@0.1.0
