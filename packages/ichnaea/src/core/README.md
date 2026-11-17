# Core: `@hephaestus-build/ichnaea`

The core of Ichnaea: the plugin host, the planner, import mode, the record store and the CLI.

- **Plugins.** A configuration lists its plugins explicitly (`defineConfig`). Plugins add measures,
  hard gates, importers, commands and lifecycle hooks. IDs are namespaced, and a conflict fails at
  load time.
- **Planner.** `createPlan` resolves a suite into a locked plan. It lists every trial before the
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
  computes a suite's measure, the second part of its identity. For a TypeScript measure,
  `moduleImplementation` imports its module in a child process with the load recorder in place
  (`load-record.ts`), and digests every local module that it loads and every third-party package,
  by version and files. A dynamic import counts, and a type-only import does not. A built-in
  scorer and a stage status take Ichnaea's build identity (`buildIdentity`: the package name and
  version and every shipped code file), and an instrument's dimension takes the instrument's pin.
  The study scripts record their loads with the same recorder.
- **Egress.** Every class of data except `none` stays in by default. Only the plugin that the
  configuration names as `governance` can let it out. Any plugin can refuse.

Decisions and reports come from the `decide` and `report` plugins.

The core imports the contracts and no other area. The package has no runtime dependency, and zod
as a peer.
