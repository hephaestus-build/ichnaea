# Support assistant example

A synthetic support assistant, evaluated in import mode. The assistant is not part of this
repository. Its own runner wrote the result files in [`results/`](results), and Ichnaea reads them.
Ichnaea makes no model call.

The example shows the whole path from the command line:

1. `import` checks another runner's results and stores them as records.
2. `decide` runs a paired non-inferiority test on the stored records. The verdict is PASS,
   REGRESSION, INCONCLUSIVE or INVALID.
3. `report` renders the stored decision as a Markdown summary and an HTML report.

The change under test is a new model with a new prompt. The base arm uses `example-model-2026-10`.
The candidate arm uses `example-model-2026-11`. Both answer the 12 cases in
[`data/cases.jsonl`](data/cases.jsonl), 3 trials each. The one primary measure,
`support/facts-stated`, is 1 when the answer states every gold fact of the case. Its margin is 15
points.

## What is in the directory

| Path                               | What it is                                                         |
| ---------------------------------- | ------------------------------------------------------------------ |
| `ichnaea.config.ts`                | The configuration: the application's plugin, `decide` and `report` |
| `plugin.ts`                        | The measure, and the importer for the application's result files   |
| `data/`                            | The cases, the case set and the suite                              |
| `configurations/`                  | The two arms' configurations                                       |
| `results/base.json`                | The base arm's results                                             |
| `results/candidate-same.json`      | A candidate that answers as well as the base                       |
| `results/candidate-regressed.json` | A candidate that answers worse than the base                       |

[`scripts/generate.ts`](scripts/generate.ts) writes all the data again, byte for byte.

## Run it

Install and build once at the repository root. The commands need Node 22.18 or later.

```sh
pnpm install
pnpm run build
```

Then run the example from this directory. `pnpm exec ichnaea` runs the CLI of the workspace.

### A candidate that answers as well as the base

```sh
pnpm exec ichnaea import --importer support/results --suite data/suite.json --case-set data/case-set.json --cases data/cases.jsonl --arm base:base:configurations/base.json --arm candidate:candidate:configurations/candidate.json --file results/base.json --file results/candidate-same.json --run same --trigger new-model --vary prompt.answer --now 2026-11-15T10:00:00Z
pnpm exec ichnaea decide --run same --now 2026-11-15T11:00:00Z # exit 0
pnpm exec ichnaea report --run same # exit 0
```

`decide` prints `PASS` and exits with 0.

### A candidate that answers worse

```sh
pnpm exec ichnaea import --importer support/results --suite data/suite.json --case-set data/case-set.json --cases data/cases.jsonl --arm base:base:configurations/base.json --arm candidate:candidate:configurations/candidate.json --file results/base.json --file results/candidate-regressed.json --run regressed --trigger new-model --vary prompt.answer --now 2026-11-15T10:00:00Z
pnpm exec ichnaea decide --run regressed --now 2026-11-15T11:00:00Z # exit 1
pnpm exec ichnaea report --run regressed # exit 0
```

`decide` prints `REGRESSION` and exits with 1. A CI job that runs `decide` blocks the change on that exit
code. The report names the broken cases, for example `support-03`.

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
