# Core: `@tumaet/ichnaea`

The core of Ichnaea: the plugin host, the planner, import mode, the record store and the CLI.

- **Plugins.** A configuration lists its plugins explicitly (`defineConfig`). Plugins add measures,
  hard gates and importers. The host refuses unknown plugin fields and duplicate IDs.
- **Planner.** `createPlan` runs inline measure examples and passes their results to the planner.
  The planner resolves a suite into a locked plan. It lists every trial before the
  first call and computes the worst-case calls. It runs a plan estimate-only, and says why, when no
  validated method can decide it. Examples: a placeholder margin, a primary measure whose values
  are not binary, one trial in some cases and more in others. At one trial per case and arm, it
  lists each case's two trials together, in the order `candidateRunsFirst` chooses from the plan
  seed, so the plan's order is the run order (decision 0020). At two or more trials, each case's
  pair in each replicate runs in the order of its own coin for that replicate. An arm given without
  a name is named by `armNames`: the base and the candidate become `a` and `b` by a coin on the seed,
  so no trial ID names its side.
- **Import mode.** `ichnaea import` turns another runner's result files into trial records and
  measure values. It makes no model call. A completed record without captured output becomes an
  infrastructure failure (`NOT_CAPTURED`). A failed trial that carries a passing value is refused.
  `--concurrency` and `--endpoint` state the schedule the trials ran on, and `--aa <run>` cites a
  decided A/A run of the store, for a suite at one trial per case.
- **Triggers.** `TRIGGER_VARIES` says what each trigger may vary between the arms. Anything else a
  change varies is declared with `--vary <factor key>`.
- **Store and ledger.** `FileStore` keeps every record as a canonical JSON line, append-only.
  `CallLedger` books each run's worst-case calls against a monthly cap before the first call.
  Every ledger line must hold a `run` and a non-negative whole number of `calls`. Other fields are
  ignored. A line that does not stops the booking with a `LedgerError` that names the file and
  the line.
- **Measure implementation.** `measureImplementation` gives the digest of the code that
  computes a suite's measure, the second part of its identity. For a TypeScript measure, it
  digests two things. `moduleImplementation` imports the module in a child process with the load
  recorder in place (`load-record.ts`), and digests every local module and every third-party
  package, by version and files, that the module loads when it is imported. An import that runs
  then counts, and a type-only import does not. The pin of the instrument that holds the module
  covers the rest: its `files` hold what the module reaches only when it scores, such as a lazy
  import, a data file or a script, and the pin also holds its image. The child process gets only
  `PATH` and `HOME`, and it is killed with `SIGKILL` after its time limit. A built-in scorer and a
  stage status take Ichnaea's build identity (`buildIdentity`: the package name and version and
  every code file that the package ships), and an instrument's dimension takes the instrument's
  pin. The study scripts record their loads with the same recorder.
  A later change makes the scorer runner record what the scoring process loads, and refuse a
  module that the lock does not hold.

`ichnaea decide` and `ichnaea report` read their data from the store. Run
`ichnaea <command> --help` for options. Commands write results to stdout and diagnostics to stderr.

The runtime export inventory is in [api/exports.json](../../api/exports.json).
API Extractor checks the TypeScript declarations. Both run in `pnpm run check:api`.

## Locked analysis plans

Use `defineSuite` to declare a case source, primary measures, and the base and candidate arms.
`ichnaea plan` writes `plan.json` and `ichnaea.lock` beside the configuration. The analysis plan
holds the base identity, case and instrument pins, the primary family, applicability and the block
horizon. The candidate binds when the run starts. `ichnaea plan --frozen` refuses a changed plan.

A suite can declare applicability in its case-set manifest. Otherwise the planner evaluates each
primary measure's applicability once for each case. The mask applies to every trial in both arms.

Use `ichnaea import --plan plan.json` to import results against the planned trial IDs. The store
keeps the analysis and the resolved arms together. A value marked not applicable inside the mask
counts as missing. Values from cases outside the mask do not enter the comparison.

The plan line gives the number of cases, blocks and calls. Each primary measure gives a detectable
drop at 80% power or the power when every candidate trial fails. Give a measure a `targetDrop`
to plan for that drop. The planner uses the per-measure level α divided by the primary family size.

Use `ichnaea plan --pilot <run>` with a noise run of the same base, cases, masks and measures.
Without a pilot, the plan uses simulated base rates. The decision estimates resolution from the
observed base-arm rates and labels that estimate. This model uses independent trials without
block shocks.

A one-arm suite can declare `trialReduction: { measure, k, cases }`. The lock pins its binary
measure and the selected cases. Decide reports pass^k and pass@k over fresh trials, with equal
case weights. If a case has fewer than k fresh binary observations, the case and the suite
aggregate are missing. The estimates have no interval.
