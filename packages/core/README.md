# @hephaestus-build/ichnaea-core

The core of Ichnaea: the plugin host, the planner, import mode, the record store and the CLI.

- **Plugins.** A configuration lists its plugins explicitly (`defineConfig`). Plugins add measures,
  hard gates, importers, commands and lifecycle hooks. IDs are namespaced, and a conflict fails at
  load time.
- **Planner.** `createPlan` resolves a suite into a locked plan. It lists every trial before the
  first call and computes the worst-case calls. It runs a plan estimate-only, and says why, when no
  validated method can decide it. Examples: one trial per case, a placeholder margin, a primary
  measure whose values are not binary.
- **Import mode.** `ichnaea import` turns another runner's result files into trial records and
  measure values. It makes no model call. A completed record without captured output becomes an
  infrastructure failure (`NOT_CAPTURED`). A failed trial that carries a passing value is refused.
- **Triggers.** `TRIGGER_VARIES` says what each trigger may vary between the arms. Anything else a
  change varies is declared with `--vary <factor key>`.
- **Store and ledger.** `FileStore` keeps every record as a canonical JSON line, append-only.
  `CallLedger` books each run's worst-case calls against a monthly cap before the first call.
  Every ledger line must hold a `run` and a non-negative whole number of `calls`. Other fields are
  ignored. A line that does not stops the booking with a `LedgerError` that names the file and
  the line.
- **Egress.** Every class of data except `none` stays in by default. Only the plugin that the
  configuration names as `governance` can let it out. Any plugin can refuse.

Decisions and reports come from the `decide` and `report` plugins.

The core has one runtime dependency, `@hephaestus-build/ichnaea-contracts`, and zod as a peer.
