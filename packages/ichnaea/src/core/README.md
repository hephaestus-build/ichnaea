# Core: `@tumaet/ichnaea`

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
- **Egress.** Every class of data except `none` stays in by default. Only the plugin that the
  configuration names as `governance` can let it out. Any plugin can refuse.

Decisions and reports come from the `decide` and `report` plugins.

The core imports the contracts and no other area. The package has no runtime dependency, and zod
as a peer.

## Import human ratings

Run `ichnaea import-ratings --run <id> --file <export.json> --key <key.json>
--registration <study.json>`. The command reads files and writes to the run's local store. It
does not load plugins or change the stored trial records, measure values, or decision. Use
`FileStore.readRatings(run, study)` to read the imported ratings and pass its `calibration`
property to `analyzeCalibration`.

Export Label Studio's full JSON with two raters and a [Number control](https://labelstud.io/tags/number.html).
Give each task an opaque `data.item_id` in the [task data](https://labelstud.io/guide/task_format).
The importer reads only the registered control's annotation. It discards task text,
unrelated annotations and rater account IDs.

Register the study before rating. Its JSON fields are `study`, `control` (the Number control's
name), `dataClass`, `scale` (ordered ratings, for example `[0, 1, 2, 3]`), and `raters` (two
entries, each with a Label Studio numeric `user`, a separate `measure` ID and its `version`), and
`judge` (an `id` and `digest` identifying the judge plus the judge `measure` and `version`).
The run must already store that measure's judge ratings as level values.
The first entry maps to the first rater in the calibration input. Each raw rating maps to its
one-based position in the registered scale.

Keep the key file local and apart from the review tool. It is a JSON object keyed by opaque
item ID. Each value gives the stored `trial`, the calibration `stratum`, and the
`configuration` (`base`, `candidate` or `known-worse`). Ratings from trials of the same
stored case belong to one calibration item.
Both raters must have one score per item. The input contains both base and candidate answers;
ordinal calibration weights every answer equally. The rating and calibration fields inherit
the study's data class in the record's egress schema.
