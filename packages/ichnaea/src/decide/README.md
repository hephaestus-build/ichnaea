# Decision rule for `@tumaet/ichnaea`

The `ichnaea decide` command and the `decide()` function apply the same rule.
`compare(plan, records, { decidedAt })` uses that rule. The same records and decision time
give the same decision.

1. **INVALID** means a record check failed. Examples include conflicting records, a budget
   overrun, and coverage below the registered floor.
2. A failed hard gate gives **REGRESSION** with `cause: "gate"`.
3. A run without verified randomized assignments gives estimates. This includes imported and
   re-scored runs.
4. A Holm-adjusted block test that rejects the sharp null in the harmful direction gives
   **REGRESSION** with `cause: "statistical"`. The size of the decrease remains uncertain.
5. **PASS** requires both lower bounds to clear the effective margin for every primary measure.
   The comparison has to be inside the validated domain.
6. Remaining randomized runs give **INCONCLUSIVE**. A within-run rejection can give
   `DROP_IN_THESE_RUNS_ONLY`. The suite can block on it with `policy.onRunDrop`.

The runner assigns the first arm independently for each case pair and replicate. The run
records the plan seed and the draws. Each recorded trial carries its seed and pair draw.
Both sharp-null tests use those assignments. The block test flips whole groups of cases.
Blocks sharing an execution context form one group. The within-run test uses the signs of
discordant pairs directly.

A missing score is filled against the claim, using the planned cases and trial counts. The block
test keeps zero contrasts and counts all ties in the tail. An abandoned block uses a slot in the
planned horizon until it has been replaced. The coverage floor and the validated PASS domain
also apply.

The block lower bound uses a common additive shift model. The within-run lower bound uses
the Miettinen–Nurminen score with case × block strata. The margin is reduced by its safety
margin before both comparisons. [Statistics validation](../stats/VALIDATION.md#randomized-block-decisions)
records the domain and the simulation results.

Planning resolution and a base-against-base pilot can help choose the number of blocks.
Neither enters the decision rule. Run the Holm-family study with
`pnpm --filter @tumaet/ichnaea run test:sim:decide`.
