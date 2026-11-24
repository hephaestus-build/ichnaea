# Support assistant example

A synthetic support assistant, evaluated in import mode. The assistant is not part of this
repository. Its own runner wrote the result files in [`results/`](results), and Ichnaea reads them.
Ichnaea makes no model call.

The example shows the whole path from the command line:

1. `import` checks another runner's results and stores them as records.
2. `decide` computes the estimates and checks the hard gates on the stored records.
3. `report` renders the stored decision as a Markdown summary and an HTML report.

The change under test is a new model with a new prompt. The base arm uses `example-model-2026-10`.
The candidate arm uses `example-model-2026-11`. Both answer the 12 cases in
[`data/cases.jsonl`](data/cases.jsonl), 3 trials each. The one primary measure,
`support/facts-stated`, is 1 when the answer states every gold fact of the case. Its margin is 15
points.

## What is in the directory

| Path                               | What it is                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| `ichnaea.config.ts`                | The configuration lists the application's plugin                 |
| `plugin.ts`                        | The measure, and the importer for the application's result files |
| `data/`                            | The cases, the case set and the suite                            |
| `configurations/`                  | The two arms' configurations                                     |
| `results/base.json`                | The base arm's results                                           |
| `results/candidate-same.json`      | A candidate that answers as well as the base                     |
| `results/candidate-regressed.json` | A candidate that answers worse than the base                     |

[`scripts/generate.ts`](scripts/generate.ts) writes all the data again, byte for byte.

## Run it

Install and build once at the repository root. The commands need Node 24.3 or later.

```sh
pnpm install
pnpm --filter @tumaet/ichnaea build
```

Then run the example from this directory. `pnpm exec ichnaea` runs the CLI of the workspace
package, `@tumaet/ichnaea`, from its build. In your own project, install the package as the
[README](../../README.md#use-ichnaea-from-a-typescript-project) shows, and the same commands run
there.

### A candidate that answers as well as the base

```sh
pnpm exec ichnaea import --importer support/results --suite data/suite.json --case-set data/case-set.json --cases data/cases.jsonl --arm base:base:configurations/base.json --arm candidate:candidate:configurations/candidate.json --file results/base.json --file results/candidate-same.json --run same --trigger new-model --vary prompt.answer --now 2026-11-15T10:00:00Z
pnpm exec ichnaea decide --run same --now 2026-11-15T11:00:00Z # exit 0
pnpm exec ichnaea report --run same # exit 0
```

`decide` prints this line and exits with 0:

`ESTIMATE-ONLY: Estimate-only: the run has no locked randomized assignments. It reports estimates, intervals, differences and flips without a verdict.`

These results came from an import. The report gives the arm rates and case flips and describes
the available evidence.

### A candidate that answers worse

```sh
pnpm exec ichnaea import --importer support/results --suite data/suite.json --case-set data/case-set.json --cases data/cases.jsonl --arm base:base:configurations/base.json --arm candidate:candidate:configurations/candidate.json --file results/base.json --file results/candidate-regressed.json --run regressed --trigger new-model --vary prompt.answer --now 2026-11-15T10:00:00Z
pnpm exec ichnaea decide --run regressed --now 2026-11-15T11:00:00Z # exit 0
pnpm exec ichnaea report --run regressed # exit 0
```

`decide` prints the same estimate-only line. The report names cases with a flipped outcome, such as `support-03`.

## What the flags mean

- `--importer support/results` names the importer that `plugin.ts` adds. It reads the files that
  `--file` lists, one per arm.
- `--arm <name>:<role>:<configuration file>` declares an arm. `base` is the system today. The
  `candidate` is the system with the change.
- `--trigger new-model` says why the run exists. Each trigger fixes what the arms may differ in. A
  new-model change may differ in the model part. `ichnaea help` lists every trigger.
- `--vary prompt.answer` declares a change beyond the trigger. The candidate also has a new prompt,
  so the run declares it. If the arms differ in anything that the trigger and `--vary` do not cover,
  `decide` returns INVALID.
- `--now` fixes the time of the record, so a run repeats byte for byte. Leave it out for a real run.

A result file may include `startedAt` and `endedAt` for each trial. The importer preserves
those times for inspection. Imported runs give estimates. Statistical verdicts use the
runner's recorded per-pair assignments.

## Where the output is written

The commands write to `.ichnaea/` in this directory. Pass `--store <directory>` to each command to
use another directory. For run `<run>`:

| File                                     | What it is                                         |
| ---------------------------------------- | -------------------------------------------------- |
| `.ichnaea/runs/<run>/decision.json`      | The decision, with every number behind the verdict |
| `.ichnaea/runs/<run>/verdict.json`       | The verdict and its reason, for a CI job to read   |
| `.ichnaea/runs/<run>/report/summary.md`  | The report as Markdown, for a CI summary           |
| `.ichnaea/runs/<run>/report/report.html` | The report as a static HTML page                   |

`.ichnaea/` holds only output. Delete it to start again.
