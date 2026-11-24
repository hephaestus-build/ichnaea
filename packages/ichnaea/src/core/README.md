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
  legacy A/A citation from the store. Randomized decisions use the recorded pair assignments.
- **Triggers.** `TRIGGER_VARIES` says what each trigger may vary between the arms. Anything else a
  change varies is declared with `--vary <factor key>`.
- **Store and ledger.** `FileStore` keeps every record as a canonical JSON line, append-only.
  `CallLedger` books each run's worst-case calls against a monthly cap before the first call.
  Every ledger line must hold a `run` and a non-negative whole number of `calls`. Other fields are
  ignored. A line that does not stops the booking with a `LedgerError` that names the file and
  the line.
- **Worker transport and recovery.** A local trial worker announces its protocol and concurrency
  capacity before it receives a request. It can report its runtime, harness and tool catalogue
  digest in the handshake. The run journal keeps the handshake and each attempt's intent and
  outcome. A run reserves each block's worst-case calls before dispatch. Resume abandons an
  interrupted block and keeps its booked calls. It draws a replacement block when the remaining
  budget covers it and the journal has no expired attempt in the interrupted block.
  A runner can take over when the owner's PID is gone on the same host or when the owner has
  missed its heartbeat for ten minutes. The journal records the reason. Sealing moves the work
  area into the run store in one rename. The index can recover decisions from sealed runs.
- **Registration and records.** To anchor a plan, the runner checks that its bytes match a
  committed plan and that its commit is an ancestor of the ref reported by `git ls-remote`.
  A shallow CI checkout registers after it fetches the plan's history and the anchor ref.
  The receipt binds the plan commit, file digest and remote SHA to the arm identities and seed.
  The journal stores the receipt before dispatch. The records checkout holds decision and case-read indexes with class-none fields.
  CI commits and pushes these files. It serializes jobs that share confirmation cases across
  checkouts. A confirmation needs a records checkout, and its reservations stay spent if the run
  fails. Exact digests cannot detect a reauthored case or a read outside the records repository.
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

## Evidence admission

Import and runner capture use `recordRun`. It binds each trial to the locked analysis digest,
checks the value's card and source, and records the judge's version and digest for judge values.
It drops values outside the applicability mask and keeps their counts. A value marked
not applicable inside the mask counts as missing. For runner evidence, a missing block,
context or timestamp gives `EXECUTION_UNRECORDED` and estimate-only output.

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

A one-arm suite can declare `mustNever` counts from a binary detector whose lower values are
better. Declare the case IDs and the detector's scope. For a deterministic detector, name the
pattern variants and give each a planted positive-control case. Reports count a hit once per
case, and count a partly observed case without a hit as missing. The report shows observed
contexts and block windows so readers can assess shared execution conditions.

### Fixture qualification

A locked primary scorer is fixture-qualified with good, bad, do-nothing, and incomplete-capture
examples. The tester pins the scorer source, applicability source, examples and declared
`instrument.files` relative to the configuration file. If a scorer or one of those files
changes, the prior test digest is stale. Declare files that supply values captured by the
scorer's closure. A do-nothing fixture must produce a failing score from captured output.
The incomplete-capture fixture starts as completed with its capture absent. Imported measures
can supply a producer-attested `validation.tester.instrumentPin`.

## Command workers

Run a suite with `ichnaea run -- node worker.ts`. The command binds the suite and
arms, draws the order of each case pair from the run seed, and starts a command
worker for each block. The worker receives the bound settings and case input.
Call `ichnaea worker check -- node worker.ts` to check the protocol with synthetic
requests and a zero-call limit.

Use `run --plan plan.json --anchor origin/main` to check the exact plan bytes
against a Git ref. If Ichnaea cannot confirm the plan commit from the checkout,
the resulting decision says `unregistered`. Fetch enough history to include
the plan commit and its parent before anchoring from a shallow checkout.

The run journal records the arm identities, seed, case-pair draws and attempts.
Resume a work area with `run --run <id> --resume -- <original worker command>`.
An interrupted block remains charged. Its replacement uses new case-pair draws and
requires enough budget to finish the locked horizon. If the journal records an expired
attempt in the interrupted block, the run seals as INVALID.

Set `records` in the configuration to the path to a records checkout. A suite
with `purpose: "confirmation"` requires this checkout. Ichnaea reserves the
exact case digests before the worker starts. A failed run leaves them spent.
Exact digests do not detect a rewritten case or a read outside the checkout.

Set `callsPerTrial` and `deadlineMs` in the suite to change the defaults of one
call and 60 seconds per trial. The analysis plan holds both values. Set `maxCalls`
high enough for every planned trial at its full allowance and for any replacement
blocks the run must be able to afford.

## Label Studio ratings

Use `ichnaea import-ratings --run <id> --file <export.json> --key <key.json> --registration <study.json>`
to import two registered raters’ completed numeric annotations for a stored run.

- The registration gives the study name, the Label Studio rating control, the ordered scale,
  the study’s protected data class, and each rater’s user ID, measure, and version. It also names the
  judge, its digest, and the measure and version that produced the stored judge scores.
- The local key maps each opaque export item ID to a trial ID, stratum, and configuration
  (`base`, `candidate`, or `known-worse`). Keep this key and the export private.
- A run importer returns the judge's `ichnaea.judge/1` record in `ImportResult.judges`. The
  measure card names that judge and the imported values declare `source: "judge"`.
  `ichnaea import` binds the judge digest to the measure and version in the run's lineage.
- The ratings import checks that binding and reads the stored judge levels. Every task needs
  one score from each registered rater.

The import writes an append-only sidecar with one canonical human value per rater and trial.
Human and judge levels keep the labels from the registered scale. `calibrationInput` converts
them to ordinal ranks for `analyzeCalibration`. The sidecar omits task content and annotator
identities. Run `ichnaea report --run <id> --ratings-study <name>` to see aggregate agreement.
