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

The core imports the contracts and the statistics functions that summarize trials on import. The
package has no runtime dependency, and zod as a peer.

## Run a command worker

Use `createPlan` to resolve a suite and write its plan before execution. Give the plan a schedule
with the ledger endpoint and concurrency. Mark the arms to run and configure the same measure
cards and local gate checks when planning and scoring. Then run:

```sh
ichnaea run --run attempt-1 --plan plan.json --case-set case-set.json --cases cases.jsonl \
  --worker node --worker-arg ./worker.mjs --deadline PT30S --monthly-cap 1000
```

The runner reserves the plan's worst-case calls for the endpoint before starting the executable.
It passes arguments directly to the executable and uses JSON Lines on stdin and stdout. The
worker begins with `ichnaea.workerReady/1`. Request dispatch follows the plan and uses at most
the smaller of the ready capacity and the scheduled concurrency. Results must follow request
order and carry the exact trial and attempt identity. Events may arrive for any in-flight trial.

`--deadline` limits one attempt in ISO seconds, excluding throttle waits that the worker reports
in heartbeats. The wall limit is three times the deadline. Only the first pending result can time
out. When an earlier result delays a later one past its deadline, the later result gets a brief
reply window and a missed window counts as an infrastructure failure.

When a trial reaches its deadline or on SIGINT/SIGTERM, the runner sends `ichnaea.cancel/1`.
A worker that does not answer within one second is stopped. An infrastructure failure or
`not_run` can retry with the next attempt while calls remain in the trial's allowance.
System and protocol failures do not retry. `--attempts` defaults to two.

The worker gets only the fields it needs from the case, without references. The runner sends
each arm's canonical configuration file. The worker reports its digest, model, generation
parameters, and declared route, code and data identities for comparison. The current protocol
has one observed model per arm. Commands retain configuration-read and module observations
in the raw results for later analysis. The store saves worker results, including earlier attempts,
alongside the normalized records. Work directories and artifacts remain under the store's
`worker/` directory. If normalization fails, `.received.jsonl` holds the accepted results. The synthetic command worker in `test/core/fixtures` provides fixtures for
order, failures, deadlines, and configuration mismatch.
